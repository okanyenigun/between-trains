import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { AgentActivityEvent, AgentSignalProvider } from "../activity/types";
import { ManualSignalProvider } from "../activity/ManualSignalProvider";
import { StatusBar } from "../status-bar/StatusBar";
import { WebviewPanelManager } from "../webview/WebviewPanelManager";
import { ConfigView, ModeView, WebviewToExtension } from "../webview/protocol";
import { ModeRegistry } from "../modes/ModeRegistry";
import { WaitingModeDescriptor } from "../modes/types";
import { resolveModeId } from "../modes/resolveModeId";
import { PreferenceStore } from "../metadata/PreferenceStore";
import { MetadataService } from "../metadata/MetadataService";
import { GameScore, newSessionId } from "../metadata/schemas";
import { OllamaClient } from "../brain/OllamaClient";
import { MemeService } from "../memes/MemeService";
import { VideoService } from "../videos/VideoService";
import { NewsService } from "../news/NewsService";
import { LearningCardsService } from "../learning/LearningCardsService";
import { LearningTopicStore } from "../learning/LearningTopicStore";
import { NewsProvider, SecretsStore } from "../config/SecretsStore";
import { Settings } from "../config/Settings";
import {
  StateChange,
  WaitingRoomState,
  WaitingRoomStateMachine,
} from "./WaitingRoomStateMachine";
import {
  LEARNING_MANAGE_ID,
  LEARNING_TOPIC_PREFIX,
  MEME_MODE_ID,
  isLearningTopicId,
  isNewsModeId,
  isVideoModeId,
  learningTopicIdOf,
  levelLabel,
} from "./modeIds";
import { ModePresenterContext } from "./presenters/context";
import { MemePresenter } from "./presenters/MemePresenter";
import { VideoPresenter } from "./presenters/VideoPresenter";
import { NewsPresenter } from "./presenters/NewsPresenter";
import { LearningPresenter } from "./presenters/LearningPresenter";

/** Minimum confidence for a provider's "active" signal to open the room. */
const CONFIDENCE_THRESHOLD = 0.75;

/** Collaborators the controller needs, injected as one named object so call
 *  sites stay readable and order-independent, and adding a dependency is a
 *  non-breaking change. */
export interface WaitingRoomControllerDeps {
  logger: OutputChannelLogger;
  manualProvider: ManualSignalProvider;
  statusBar: StatusBar;
  panel: WebviewPanelManager;
  registry: ModeRegistry;
  prefs: PreferenceStore;
  settings: Settings;
  metadata: MetadataService;
  ollama: OllamaClient;
  memes: MemeService;
  videos: VideoService;
  news: NewsService;
  secrets: SecretsStore;
  learning: LearningCardsService;
  topics: LearningTopicStore;
}

/**
 * Central coordinator for the waiting-room lifecycle. Signal providers report
 * activity, this maps it onto the state machine, and state changes drive the
 * status bar, webview panel, and selected mode. Per-mode content is delegated to
 * the presenters; the controller owns the lifecycle, the panel shell, the global
 * config view, and mode registration.
 */
export class WaitingRoomController implements vscode.Disposable {
  private readonly machine = new WaitingRoomStateMachine();
  private readonly disposables: vscode.Disposable[] = [];
  private sessionStartedAt?: number;
  private currentLabel = "Manual session";
  private currentTrigger = "manual";
  private currentSessionId?: string;
  private pendingEndReason?: string;
  private _currentModeId?: string;

  private readonly logger: OutputChannelLogger;
  private readonly manualProvider: ManualSignalProvider;
  private readonly statusBar: StatusBar;
  private readonly panel: WebviewPanelManager;
  private readonly registry: ModeRegistry;
  private readonly prefs: PreferenceStore;
  private readonly settings: Settings;
  private readonly metadata: MetadataService;
  private readonly ollama: OllamaClient;
  private readonly memes: MemeService;
  private readonly videos: VideoService;
  private readonly news: NewsService;
  private readonly secrets: SecretsStore;
  private readonly learning: LearningCardsService;
  private readonly topics: LearningTopicStore;

  private readonly memePresenter: MemePresenter;
  private readonly videoPresenter: VideoPresenter;
  private readonly newsPresenter: NewsPresenter;
  private readonly learningPresenter: LearningPresenter;

  constructor(deps: WaitingRoomControllerDeps) {
    this.logger = deps.logger;
    this.manualProvider = deps.manualProvider;
    this.statusBar = deps.statusBar;
    this.panel = deps.panel;
    this.registry = deps.registry;
    this.prefs = deps.prefs;
    this.settings = deps.settings;
    this.metadata = deps.metadata;
    this.ollama = deps.ollama;
    this.memes = deps.memes;
    this.videos = deps.videos;
    this.news = deps.news;
    this.secrets = deps.secrets;
    this.learning = deps.learning;
    this.topics = deps.topics;

    const ctx: ModePresenterContext = {
      panel: this.panel,
      settings: this.settings,
      metadata: this.metadata,
      logger: this.logger,
      currentModeId: () => this._currentModeId,
      currentSessionId: () => this.currentSessionId,
      confirmClear: (what) => this.confirmClear(what),
      setMode: (id) => this.setMode(id),
    };
    this.memePresenter = new MemePresenter(ctx, this.memes);
    this.videoPresenter = new VideoPresenter(ctx, this.videos);
    this.newsPresenter = new NewsPresenter(ctx, this.news);
    this.learningPresenter = new LearningPresenter(ctx, this.learning, this.topics);

    this.syncLearningModes();
    this._currentModeId = this.resolveModeForSession();
    this.disposables.push(
      this.machine.onDidChangeState((c) => this.onStateChange(c)),
      this.panel.onMessage((m) => this.handleWebviewMessage(m)),
      this.panel.onClose(() => this.onPanelClosed()),
      this.memes.onDidChangeStatus(() => void this.memePresenter.pushState(false)),
      this.videos.onDidChangeStatus(() => void this.videoPresenter.pushState(false)),
      this.news.onDidChangeStatus(() => void this.newsPresenter.pushState(false, false)),
      this.topics.onDidChange(() => this.syncLearningModes()),
      this.learning.onDidChangeStatus(() => void this.learningPresenter.refreshCurrent()),
      vscode.workspace.onDidChangeConfiguration((e) => this.onConfigChanged(e))
    );
    this.registerProvider(this.manualProvider);
    void this.manualProvider.start();
    this.refreshStatusBar();
  }

  /**
   * Route one validated webview message to its handler. The manager has already
   * checked the shape, so `message` is a fully-typed discriminated union; the
   * exhaustive switch keeps this in sync with the protocol at compile time.
   */
  private handleWebviewMessage(message: WebviewToExtension): void {
    switch (message.type) {
      case "panel/ready":
        this.onPanelReady();
        break;
      case "session/stop":
        this.stopSession();
        break;
      case "mode/select":
        this.setMode(message.id);
        break;
      case "config/open":
        void this.openConfig();
        break;
      case "config/close":
        this.renderModeContent();
        break;
      case "config/refreshModels":
        void this.openConfig();
        break;
      case "config/setProvider":
        void this.setProvider(message.value);
        break;
      case "config/setModel":
        void this.setModel(message.value);
        break;
      case "config/setNewsProvider":
        void this.setNewsProvider(message.value);
        break;
      case "config/setNewsApiKey":
        void this.setNewsApiKey();
        break;
      case "config/clearNewsApiKey":
        void this.clearNewsApiKey();
        break;
      case "config/openKeybindings":
        this.openShortcutSettings();
        break;
      case "config/openStats":
        void this.openStats();
        break;
      case "config/openStorage":
        void this.openStorageFolder();
        break;
      case "game/started":
        this.onGameStarted(message.gameId);
        break;
      case "game/completed":
        this.onGameCompleted(message.gameId, message.score);
        break;
      case "game/statsRequest":
        void this.pushGameStats(message.gameId);
        break;
      case "meme/next":
        void this.memePresenter.pushState(true);
        break;
      case "meme/rate":
        void this.memePresenter.rate(message.id, message.liked);
        break;
      case "meme/fetchNow":
        this.memePresenter.fetchNow();
        break;
      case "meme/setAutoFetch":
        void this.memePresenter.setAutoFetch(message.value);
        break;
      case "meme/clearLibrary":
        void this.memePresenter.clearLibrary();
        break;
      case "video/next":
        void this.videoPresenter.pushState(true);
        break;
      case "video/rate":
        void this.videoPresenter.rate(message.id, message.liked);
        break;
      case "video/replay":
        void this.videoPresenter.replay(message.id);
        break;
      case "video/openExternal":
        this.videoPresenter.openExternal(message.videoId);
        break;
      case "video/fetchNow":
        this.videoPresenter.fetchNow();
        break;
      case "video/setAutoFetch":
        void this.videoPresenter.setAutoFetch(message.value);
        break;
      case "video/clearLibrary":
        void this.videoPresenter.clearLibrary();
        break;
      case "news/next":
        void this.newsPresenter.step(1);
        break;
      case "news/prev":
        void this.newsPresenter.step(-1);
        break;
      case "news/refresh":
        this.newsPresenter.refresh();
        break;
      case "news/openLink":
        void this.newsPresenter.openLink(message.id);
        break;
      case "news/setAutoFetch":
        void this.newsPresenter.setAutoFetch(message.value);
        break;
      case "news/clearLibrary":
        void this.newsPresenter.clearLibrary();
        break;
      case "learning/next":
        void this.learningPresenter.step(1);
        break;
      case "learning/prev":
        void this.learningPresenter.step(-1);
        break;
      case "learning/rate":
        void this.learningPresenter.rate(message.id, message.known);
        break;
      case "learning/generate":
        void this.learningPresenter.generate();
        break;
      case "learning/setAutoFetch":
        void this.learningPresenter.setAutoFetch(message.value);
        break;
      case "learning/clearLibrary":
        void this.learningPresenter.clearLibrary();
        break;
      case "learning/addTopic":
        void this.learningPresenter.addTopic();
        break;
      case "learning/removeTopic":
        void this.learningPresenter.removeTopic(message.id);
        break;
      default:
        assertNever(message);
    }
  }

  /** React to the `enabled` master switch changing while the extension runs. */
  private onConfigChanged(e: vscode.ConfigurationChangeEvent): void {
    if (!e.affectsConfiguration("betweenTrains.enabled")) {
      return;
    }
    if (!this.settings.enabled && this.machine.state !== "inactive") {
      this.stopSession();
    }
    this.refreshStatusBar();
  }

  get currentModeId(): string | undefined {
    return this._currentModeId;
  }

  get state(): WaitingRoomState {
    return this.machine.state;
  }

  get elapsedMs(): number {
    return this.sessionStartedAt ? Date.now() - this.sessionStartedAt : 0;
  }

  /** Start a manually-triggered waiting session. */
  startManualSession(): void {
    if (!this.settings.enabled) {
      this.logger.info("Manual start ignored — Between Trains is disabled in settings");
      void vscode.window.showInformationMessage(
        "Between Trains is disabled. Enable it in settings to start a waiting session."
      );
      this.refreshStatusBar();
      return;
    }
    if (this.machine.state === "active" || this.machine.state === "maybeActive") {
      this.logger.info("Manual start ignored — a session is already active");
      this.panel.reveal();
      return;
    }
    this.manualProvider.beginSession();
  }

  /** Open the waiting room: reveal it if a session is live, else start one. */
  openWaitingRoom(): void {
    if (this.machine.state === "inactive") {
      this.startManualSession();
    } else {
      this.panel.open();
    }
  }

  /** Toggle the waiting room open/closed — the keyboard-shortcut entry point. */
  toggleWaitingRoom(): void {
    if (this.machine.state === "inactive") {
      this.openWaitingRoom();
    } else {
      this.stopSession();
    }
  }

  /** Open VS Code's Keyboard Shortcuts editor filtered to Between Trains. */
  openShortcutSettings(): void {
    void vscode.commands.executeCommand(
      "workbench.action.openGlobalKeybindings",
      "Between Trains"
    );
  }

  /** Build usage stats from the local records and render the stats screen. */
  private async openStats(): Promise<void> {
    if (!this.panel.isOpen) {
      return;
    }
    const raw = await this.metadata.buildStats();
    const label = (id: string): string => this.registry.get(id)?.title ?? id;
    this.panel.sendStats({
      enabled: raw.enabled,
      events: raw.events,
      sessions: raw.sessions,
      totalActiveMs: raw.totalActiveMs,
      firstAt: raw.firstAt,
      lastAt: raw.lastAt,
      topModes: raw.topModes.map((m) => ({ label: label(m.modeId), count: m.count })),
      games: raw.games.map((g) => ({ label: label(g.gameId), plays: g.plays, best: g.best })),
      memes: raw.memes,
      videos: raw.videos,
      news: raw.news,
      learning: raw.learning,
    });
  }

  /** Reveal the extension's local records folder in the OS file explorer. */
  private async openStorageFolder(): Promise<void> {
    const uri = await this.metadata.revealUri();
    await vscode.commands.executeCommand("revealFileInOS", uri);
  }

  /** Stop the current waiting session, whatever triggered it. */
  stopSession(): void {
    if (this.machine.state === "inactive") {
      this.logger.info("Stop ignored — no active session");
      return;
    }
    this.pendingEndReason = "user_stopped";
    this.manualProvider.endSession("user_stopped");
    this.machine.reset();
  }

  /** Switch to a specific mode; persists it as the last-used mode. */
  setMode(id: string): void {
    if (!this.registry.has(id)) {
      this.logger.warn(`Ignoring unknown mode: ${id}`);
      return;
    }
    this._currentModeId = id;
    void this.prefs.setLastModeId(id);
    this.logger.info(`Mode selected: ${id}`);
    if (this.currentSessionId) {
      this.metadata.record({ type: "mode_selected", sessionId: this.currentSessionId, modeId: id });
    }
    if (this.panel.isOpen) {
      this.syncPanel();
      this.renderModeContent();
    } else {
      const title = this.registry.get(id)?.title ?? id;
      vscode.window.setStatusBarMessage(`Between Trains: next session opens in ${title}`, 2500);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private registerProvider(provider: AgentSignalProvider): void {
    this.disposables.push(provider.onActivityChanged((e) => this.onActivity(e)));
  }

  /** Map a provider signal onto a state-machine event. */
  private onActivity(event: AgentActivityEvent): void {
    if (event.label) {
      this.currentLabel = event.label;
    }
    this.currentTrigger = event.providerId;
    this.logger.info(
      `Signal [${event.providerId}] ${event.phase} @ ${event.confidence.toFixed(2)}`
    );
    switch (event.phase) {
      case "active":
        this.machine.send(
          event.confidence >= CONFIDENCE_THRESHOLD ? "activity_confirmed" : "session_started"
        );
        break;
      case "maybe-active":
        this.machine.send("session_started");
        break;
      case "waiting-for-user":
      case "completed":
        this.machine.send("session_finishing");
        break;
      case "inactive":
        this.machine.send("session_ended");
        break;
      case "failed":
        this.machine.send("error");
        break;
    }
  }

  private onStateChange(change: StateChange): void {
    this.logger.info(`Waiting room: ${change.from} → ${change.to} (${change.event})`);
    switch (change.to) {
      case "active":
        this.sessionStartedAt = change.at;
        this.currentSessionId = newSessionId();
        this._currentModeId = this.resolveModeForSession();
        this.metadata.record({
          type: "session_started",
          sessionId: this.currentSessionId,
          trigger: this.currentTrigger,
        });
        if (this._currentModeId) {
          this.metadata.record({
            type: "mode_selected",
            sessionId: this.currentSessionId,
            modeId: this._currentModeId,
          });
        }
        this.refreshStatusBar();
        this.panel.open();
        this.syncPanel();
        break;
      case "finishing":
        this.refreshStatusBar();
        this.syncPanel();
        break;
      case "inactive":
        if (this.currentSessionId) {
          this.metadata.record({
            type: "session_ended",
            sessionId: this.currentSessionId,
            reason: this.pendingEndReason ?? "ended",
            durationMs: this.sessionStartedAt ? change.at - this.sessionStartedAt : 0,
          });
        }
        this.currentSessionId = undefined;
        this.pendingEndReason = undefined;
        this.sessionStartedAt = undefined;
        this.refreshStatusBar();
        this.panel.close();
        break;
      case "maybeActive":
        break;
    }
  }

  /** Reflect the `enabled` setting + current lifecycle state in the status bar. */
  private refreshStatusBar(): void {
    if (!this.settings.enabled) {
      this.statusBar.setDisabled();
      return;
    }
    switch (this.machine.state) {
      case "active":
      case "maybeActive":
        this.statusBar.setWaiting(this.currentLabel);
        break;
      case "finishing":
        this.statusBar.setFinishing();
        break;
      default:
        this.statusBar.setIdle();
    }
  }

  private onPanelReady(): void {
    this.syncPanel();
    this.renderModeContent();
  }

  /** Push the current session + mode list to the panel header (no content). */
  private syncPanel(): void {
    if (!this.panel.isOpen) {
      return;
    }
    const mode = this._currentModeId ? this.registry.get(this._currentModeId) : undefined;
    this.panel.updateSession({
      state: this.machine.state,
      activityLabel: this.currentLabel,
      startedAt: this.sessionStartedAt,
      modeId: mode?.id,
      modeTitle: mode?.title,
    });
    this.panel.sendModeList(
      this.registry.listEnabled().map((m) => this.toModeView(m)),
      this._currentModeId
    );
  }

  /** Render the main content area for the current mode by delegating to its presenter. */
  private renderModeContent(): void {
    if (!this.panel.isOpen) {
      return;
    }
    const mode = this._currentModeId ? this.registry.get(this._currentModeId) : undefined;
    if (!mode) {
      return;
    }
    this.panel.renderMode(this.toModeView(mode));
    if (mode.id === MEME_MODE_ID) {
      void this.memePresenter.open();
    } else if (isVideoModeId(mode.id)) {
      void this.videoPresenter.open();
    } else if (isNewsModeId(mode.id)) {
      void this.newsPresenter.open();
    } else if (mode.id === LEARNING_MANAGE_ID) {
      this.learningPresenter.pushTopics();
    } else if (isLearningTopicId(mode.id)) {
      void this.learningPresenter.open(learningTopicIdOf(mode.id));
    }
  }

  private onGameStarted(gameId: string): void {
    if (this.currentSessionId) {
      this.metadata.record({ type: "microgame_started", sessionId: this.currentSessionId, gameId });
    }
  }

  private onGameCompleted(gameId: string, score?: number): void {
    if (this.currentSessionId) {
      this.metadata.record({
        type: "microgame_completed",
        sessionId: this.currentSessionId,
        gameId,
        score,
      });
    }
    if (typeof score === "number") {
      void this.metadata
        .recordGameScore(gameId, score)
        .then((updated) => this.pushGameStats(gameId, updated));
    }
  }

  /** Send a game's high scores to the panel (used on request + after a run). */
  private async pushGameStats(gameId: string, known?: GameScore): Promise<void> {
    if (!this.panel.isOpen) {
      return;
    }
    const score = known ?? (await this.metadata.getGameScore(gameId));
    this.panel.sendGameStats(gameId, score?.best ?? null, score?.plays ?? 0);
  }

  /** Modal confirmation before wiping a library — destructive and irreversible. */
  private async confirmClear(what: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Remove ${what} from your local library? This cannot be undone.`,
      { modal: true },
      "Clear"
    );
    return choice === "Clear";
  }

  // --- learning mode registration (dynamic topics) --------------------------

  /** Re-register the dynamic `learning.topic.*` modes from the topic store. */
  private syncLearningModes(): void {
    for (const mode of this.registry.list()) {
      if (isLearningTopicId(mode.id)) {
        this.registry.unregister(mode.id);
      }
    }
    for (const topic of this.topics.list()) {
      this.registry.register({
        id: LEARNING_TOPIC_PREFIX + topic.id,
        title: topic.title,
        description: `${levelLabel(topic.level)} learning cards about ${topic.title}.`,
        category: "learning",
        enabled: true,
        requiresBrain: true,
      });
    }
    this.syncPanel();
  }

  // --- news config (in the global config view) ------------------------------

  private newsProvider(): NewsProvider {
    return this.news.provider();
  }

  private async setNewsProvider(value: string): Promise<void> {
    await this.settings.setNewsProvider(value);
    this.logger.info(`News provider set to ${value}`);
    await this.openConfig(); // the "key set" status differs per provider
  }

  private async setNewsApiKey(): Promise<void> {
    const provider = this.newsProvider();
    const key = await vscode.window.showInputBox({
      title: `${provider} API key`,
      prompt: `Paste your ${provider} API key. It is stored securely in VS Code SecretStorage.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) {
      return; // cancelled
    }
    const trimmed = key.trim();
    if (trimmed) {
      await this.secrets.setNewsApiKey(provider, trimmed);
      this.logger.info(`News API key stored for ${provider}`);
      void vscode.window.showInformationMessage(`Between Trains: ${provider} API key saved.`);
    }
    await this.openConfig();
    await this.newsPresenter.pushState(false, false);
  }

  private async clearNewsApiKey(): Promise<void> {
    const provider = this.newsProvider();
    await this.secrets.clearNewsApiKey(provider);
    this.logger.info(`News API key cleared for ${provider}`);
    await this.openConfig();
    await this.newsPresenter.pushState(false, false);
  }

  // --- global config --------------------------------------------------------

  /** Show the global config view (provider + model), fetching live models. */
  private async openConfig(): Promise<void> {
    if (!this.panel.isOpen) {
      return;
    }
    this.panel.showConfig(await this.buildConfigView());
  }

  private async buildConfigView(): Promise<ConfigView> {
    const provider = this.settings.brainProvider;
    const providers = [{ id: "ollama", label: "Ollama" }];
    const model = this.settings.ollamaModel;

    let models: string[] = [];
    let reachable = false;
    let note: string | undefined;

    if (provider === "ollama") {
      const status = await this.ollama.status();
      reachable = status.reachable;
      models = status.models;
      if (!reachable) {
        note = `Couldn't reach Ollama at ${status.baseUrl}. Start it with "ollama serve", then Refresh.`;
      } else if (models.length === 0) {
        note = 'No models installed. Pull one, e.g. "ollama pull llama3.2", then Refresh.';
      }
    }

    const newsProvider = this.newsProvider();
    const newsKeySet = await this.secrets.hasNewsApiKey(newsProvider);

    return {
      provider,
      providers,
      model,
      models,
      reachable,
      note,
      newsProvider,
      newsProviders: [
        { id: "tavily", label: "Tavily" },
        { id: "brave", label: "Brave" },
        { id: "serper", label: "Serper" },
      ],
      newsKeySet,
    };
  }

  private async setProvider(value: string): Promise<void> {
    await this.settings.setBrainProvider(value);
    this.logger.info(`Brain provider set to ${value}`);
    await this.openConfig(); // providers expose different models
  }

  private async setModel(value: string): Promise<void> {
    await this.settings.setOllamaModel(value);
    this.logger.info(`Model set to ${value}`);
    vscode.window.setStatusBarMessage(`Between Trains: model set to ${value}`, 2500);
  }

  private toModeView(mode: WaitingModeDescriptor): ModeView {
    return {
      id: mode.id,
      title: mode.title,
      description: mode.description,
      category: mode.category,
      requiresBrain: mode.requiresBrain,
      requiresNetwork: mode.requiresNetwork,
    };
  }

  private resolveModeForSession(): string | undefined {
    return resolveModeId(this.settings.defaultMode, this.prefs.getLastModeId(), this.registry);
  }

  /** The user closed the panel; treat that as ending the manual session. */
  private onPanelClosed(): void {
    if (this.machine.state === "inactive") {
      return; // we closed it as part of ending the session — nothing to do
    }
    this.logger.info("Waiting room panel closed by user");
    this.pendingEndReason = "panel_closed";
    this.manualProvider.endSession("panel_closed");
    this.machine.reset();
  }
}

/**
 * Compile-time exhaustiveness guard: if a new message type is added to the
 * protocol union without a matching `case`, the argument stops being `never`
 * and this call fails to type-check.
 */
function assertNever(value: never): void {
  void value;
}
