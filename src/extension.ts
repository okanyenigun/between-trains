import * as vscode from "vscode";
import { OutputChannelLogger } from "./logging/OutputChannelLogger";
import { registerCommands } from "./activation/registerCommands";
import { ManualSignalProvider } from "./activity/ManualSignalProvider";
import { StatusBar } from "./status-bar/StatusBar";
import { WebviewPanelManager } from "./webview/WebviewPanelManager";
import { WaitingRoomController } from "./waiting-room/WaitingRoomController";
import { ModeRegistry } from "./modes/ModeRegistry";
import { registerBuiltInModes } from "./modes/builtInModes";
import { PreferenceStore } from "./metadata/PreferenceStore";
import { MetadataService } from "./metadata/MetadataService";
import { OllamaClient } from "./brain/OllamaClient";
import { GifLibrary } from "./memes/GifLibrary";
import { MemeService } from "./memes/MemeService";
import { VideoLibrary } from "./videos/VideoLibrary";
import { VideoService } from "./videos/VideoService";
import { NewsLibrary } from "./news/NewsLibrary";
import { NewsService } from "./news/NewsService";
import { LearningLibrary } from "./learning/LearningLibrary";
import { LearningTopicStore } from "./learning/LearningTopicStore";
import { LearningCardsService } from "./learning/LearningCardsService";
import { SecretsStore } from "./config/SecretsStore";
import { FetchThrottle } from "./config/FetchThrottle";
import { Settings } from "./config/Settings";

let logger: OutputChannelLogger | undefined;

/**
 * Extension entry point.
 *
 * Keep this thin: create shared services, register commands and disposables,
 * and nothing else. Feature logic (state machine, providers, controller,
 * surface, modes, and later the Ollama layer) lives in dedicated modules.
 */
export function activate(context: vscode.ExtensionContext): void {
  logger = new OutputChannelLogger();
  context.subscriptions.push(logger);

  const settings = new Settings();
  const registry = new ModeRegistry();
  registerBuiltInModes(registry);
  const prefs = new PreferenceStore(context.globalState);
  const metadata = new MetadataService(context.globalStorageUri, settings, prefs, logger);
  const ollama = new OllamaClient(settings);
  const fetchThrottle = new FetchThrottle(context.globalState);
  const gifLibrary = new GifLibrary(context.globalStorageUri, logger);
  const memes = new MemeService(gifLibrary, settings, metadata, logger, fetchThrottle);
  const videoLibrary = new VideoLibrary(context.globalStorageUri, logger);
  const videos = new VideoService(videoLibrary, settings, metadata, logger, fetchThrottle);
  const secrets = new SecretsStore(context.secrets);
  const newsLibrary = new NewsLibrary(context.globalStorageUri, logger);
  const news = new NewsService(newsLibrary, settings, secrets, metadata, logger, fetchThrottle);
  const learningTopics = new LearningTopicStore(context.globalState);
  const learningLibrary = new LearningLibrary(context.globalStorageUri, logger);
  const learning = new LearningCardsService(
    learningLibrary,
    learningTopics,
    settings,
    metadata,
    ollama,
    logger,
    fetchThrottle
  );

  const manualProvider = new ManualSignalProvider();
  const statusBar = new StatusBar();
  const panel = new WebviewPanelManager(context.extensionUri, [gifLibrary.rootUri]);
  const controller = new WaitingRoomController({
    logger,
    manualProvider,
    statusBar,
    panel,
    registry,
    prefs,
    settings,
    metadata,
    ollama,
    memes,
    videos,
    news,
    secrets,
    learning,
    topics: learningTopics,
  });

  context.subscriptions.push(
    manualProvider,
    statusBar,
    panel,
    controller,
    memes,
    videos,
    news,
    learning,
    learningTopics
  );

  registerCommands({
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
  });

  // Prune expired session traces off the critical path.
  void metadata.pruneOldSessions(settings.metadataRetentionDays);

  logger.info("Between Trains activated");
}

export function deactivate(): void {
  logger?.info("Between Trains deactivated");
}
