import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { WaitingRoomController } from "../waiting-room/WaitingRoomController";
import { ModeRegistry } from "../modes/ModeRegistry";
import { pickMode } from "../modes/ModeSelector";
import { MetadataService } from "../metadata/MetadataService";
import { OllamaClient } from "../brain/OllamaClient";
import { MemeService } from "../memes/MemeService";
import { GifLibrary } from "../memes/GifLibrary";
import { VideoService } from "../videos/VideoService";
import { VideoLibrary } from "../videos/VideoLibrary";
import { NewsLibrary } from "../news/NewsLibrary";
import { LearningLibrary } from "../learning/LearningLibrary";
import { SecretsStore, NewsProvider } from "../config/SecretsStore";
import { Commands } from "../commands";

export { Commands };

const encoder = new TextEncoder();

/**
 * Wraps a command handler in a top-level error boundary so a failing command
 * never leaks a raw stack trace into a user-facing notification.
 */
async function runSafely(
  logger: OutputChannelLogger,
  operation: string,
  handler: () => void | Promise<void>
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    logger.error(`Command failed: ${operation}`, error);
    void vscode.window.showErrorMessage(
      `Between Trains: something went wrong running "${operation}". See the output channel for details.`
    );
  }
}

/** Modal confirmation before a destructive, irreversible action. */
async function confirm(prompt: string, confirmLabel: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    prompt,
    { modal: true },
    confirmLabel
  );
  return choice === confirmLabel;
}

/** Everything {@link registerCommands} wires up, passed as one named object. */
export interface RegisterCommandsDeps {
  context: vscode.ExtensionContext;
  logger: OutputChannelLogger;
  controller: WaitingRoomController;
  registry: ModeRegistry;
  metadata: MetadataService;
  ollama: OllamaClient;
  memes: MemeService;
  gifLibrary: GifLibrary;
  videos: VideoService;
  videoLibrary: VideoLibrary;
  newsLibrary: NewsLibrary;
  secrets: SecretsStore;
  learningLibrary: LearningLibrary;
}

/**
 * Registers all Between Trains commands and routes them through the controller
 * and metadata service. Commands never touch the state machine, providers, or
 * storage directly.
 */
export function registerCommands(deps: RegisterCommandsDeps): void {
  const {
    context,
    logger,
    controller,
    registry,
    metadata,
    ollama,
    memes,
    gifLibrary,
    videos,
    videoLibrary,
    newsLibrary,
    secrets,
    learningLibrary,
  } = deps;
  const register = (id: string, handler: () => void | Promise<void>): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => runSafely(logger, id, handler))
    );
  };

  // --- session + modes ------------------------------------------------------

  register(Commands.startManualSession, () => controller.startManualSession());
  register(Commands.stopSession, () => controller.stopSession());
  register(Commands.openWaitingRoom, () => controller.openWaitingRoom());
  register(Commands.toggleWaitingRoom, () => controller.toggleWaitingRoom());

  register(Commands.selectMode, async () => {
    const id = await pickMode(registry, controller.currentModeId);
    if (id) {
      controller.setMode(id);
    }
  });

  register(Commands.openSettings, async () => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:between-trains.between-trains"
    );
  });

  // --- brain ----------------------------------------------------------------

  register(Commands.testOllamaConnection, async () => {
    const status = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Between Trains: testing Ollama…" },
      () => ollama.status()
    );
    if (!status.reachable) {
      void vscode.window.showWarningMessage(
        `Between Trains: could not reach Ollama at ${status.baseUrl}${status.error ? ` (${status.error})` : ""}. Memes/videos/news fall back to an offline fetcher; Learning Cards need Ollama running.`
      );
      return;
    }
    if (!status.modelAvailable) {
      void vscode.window.showWarningMessage(
        status.model
          ? `Between Trains: connected to Ollama at ${status.baseUrl}, but model "${status.model}" isn't installed. Run "ollama pull ${status.model}", or pick an installed model in Global config. Installed: ${status.models.join(", ") || "none"}.`
          : `Between Trains: connected to Ollama at ${status.baseUrl}, but no models are installed. Pull one, e.g. "ollama pull llama3.2".`
      );
      return;
    }
    void vscode.window.showInformationMessage(
      status.model
        ? `Between Trains: connected to Ollama at ${status.baseUrl} — model "${status.model}" is ready.`
        : `Between Trains: connected to Ollama at ${status.baseUrl} — will auto-use "${status.models[0]}". Set a model in settings to pin a specific one.`
    );
  });

  register(Commands.fetchMemes, async () => {
    void vscode.window.showInformationMessage(
      "Between Trains: fetching new memes in the background…"
    );
    await memes.fetchBatch("manual");
    const status = memes.getStatus();
    const saved = status.lastResult?.saved ?? 0;
    void vscode.window.showInformationMessage(
      saved > 0
        ? `Between Trains: saved ${saved} new memes.`
        : "Between Trains: could not fetch memes — check your network and the output channel."
    );
  });

  register(Commands.fetchVideos, async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: "Programming Videos", videoKind: "programming" as const },
        { label: "Random Videos", videoKind: "random" as const },
      ],
      { title: "Fetch which kind of videos?" }
    );
    if (!pick) {
      return;
    }
    void vscode.window.showInformationMessage(
      "Between Trains: fetching new videos in the background…"
    );
    await videos.fetchBatch("manual", pick.videoKind);
    const saved = videos.getStatus().lastResult?.saved ?? 0;
    void vscode.window.showInformationMessage(
      saved > 0
        ? `Between Trains: saved ${saved} new videos.`
        : "Between Trains: could not fetch videos — check your network and the output channel."
    );
  });

  register(Commands.setNewsApiKey, async () => {
    const providerPick = await vscode.window.showQuickPick(
      [
        { label: "Tavily", value: "tavily" as NewsProvider },
        { label: "Brave", value: "brave" as NewsProvider },
        { label: "Serper", value: "serper" as NewsProvider },
      ],
      { title: "Which news search provider?" }
    );
    if (!providerPick) {
      return;
    }
    const key = await vscode.window.showInputBox({
      title: `${providerPick.value} API key`,
      prompt: `Paste your ${providerPick.value} API key. It is stored securely in VS Code SecretStorage.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) {
      return;
    }
    const trimmed = key.trim();
    if (trimmed) {
      await secrets.setNewsApiKey(providerPick.value, trimmed);
      void vscode.window.showInformationMessage(
        `Between Trains: ${providerPick.value} API key saved.`
      );
    } else {
      await secrets.clearNewsApiKey(providerPick.value);
      void vscode.window.showInformationMessage(
        `Between Trains: ${providerPick.value} API key cleared.`
      );
    }
  });

  // --- local metadata controls ---------------------------------------------

  register(Commands.showLocalMetadata, async () => {
    const uri = await metadata.revealUri();
    await vscode.commands.executeCommand("revealFileInOS", uri);
  });

  register(Commands.exportLocalMetadata, async () => {
    const target = await vscode.window.showSaveDialog({
      title: "Export Between Trains metadata",
      saveLabel: "Export",
      defaultUri: vscode.Uri.joinPath(metadata.storageUri, "between-trains-metadata.json"),
      filters: { JSON: ["json"] },
    });
    if (!target) {
      return;
    }
    const bundle = await metadata.buildExport();
    await vscode.workspace.fs.writeFile(target, encoder.encode(JSON.stringify(bundle, null, 2)));
    void vscode.window.showInformationMessage("Between Trains: local metadata exported.");
  });

  register(Commands.clearSessionHistory, async () => {
    if (!(await confirm("Clear all Between Trains session history?", "Clear History"))) {
      return;
    }
    await metadata.clearSessionHistory();
    void vscode.window.showInformationMessage("Between Trains: session history cleared.");
  });

  register(Commands.resetPersonalization, async () => {
    if (!(await confirm("Reset Between Trains personalization (mode stats and last-used mode)?", "Reset"))) {
      return;
    }
    await metadata.resetPersonalization();
    void vscode.window.showInformationMessage("Between Trains: personalization reset.");
  });

  register(Commands.clearGeneratedContentCache, async () => {
    if (!(await confirm("Clear Between Trains generated content cache?", "Clear Cache"))) {
      return;
    }
    await metadata.clearGeneratedContentCache();
    void vscode.window.showInformationMessage("Between Trains: generated content cache cleared.");
  });

  register(Commands.clearLocalMetadata, async () => {
    if (
      !(await confirm(
        "Clear ALL Between Trains local data (session history, personalization, cache, and all saved libraries — GIFs, videos, news, and learning cards)? This cannot be undone.",
        "Clear All"
      ))
    ) {
      return;
    }
    await metadata.clearAll();
    await gifLibrary.clearAll();
    await videoLibrary.clearAll();
    await newsLibrary.clearAll();
    await learningLibrary.clearAll();
    void vscode.window.showInformationMessage("Between Trains: all local metadata cleared.");
  });

  logger.info("Registered Between Trains commands");
}
