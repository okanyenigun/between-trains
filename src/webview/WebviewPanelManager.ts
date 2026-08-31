import * as vscode from "vscode";
import { buildCsp } from "./csp";
import { getNonce } from "./getNonce";
import {
  ConfigView,
  ExtensionToWebview,
  StatsView,
  LearningStateView,
  LearningTopicsView,
  MemeStateView,
  ModeView,
  NewsStateView,
  SessionInfo,
  VideoStateView,
  WebviewToExtension,
  isWebviewToExtension,
} from "./protocol";

const VIEW_TYPE = "betweenTrains.waitingRoom";
const TITLE = "Between Trains";

/**
 * Owns the lifecycle of the waiting-room webview panel: lazy creation, reveal,
 * secure HTML generation, message routing, and disposal. It knows nothing about
 * the session state machine or the modes rendered in it: inbound webview
 * messages are validated and re-emitted, verbatim, on a single {@link onMessage}
 * event that the controller switches on. Outbound updates go through the typed
 * `send*`/`show*` methods.
 */
export class WebviewPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelDisposables: vscode.Disposable[] = [];

  private readonly _onMessage = new vscode.EventEmitter<WebviewToExtension>();
  /**
   * Fired with every validated message from the webview. The payload is a
   * discriminated union, so consumers switch on `message.type`.
   */
  readonly onMessage = this._onMessage.event;

  private readonly _onClose = new vscode.EventEmitter<void>();
  /** Fired when the panel is disposed (user closed it or we closed it). */
  readonly onClose = this._onClose.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Extra folders the webview may load resources from (e.g. the gif library). */
    private readonly extraResourceRoots: vscode.Uri[] = []
  ) {}

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  /** Create the panel lazily, or reveal it if it already exists. */
  open(): void {
    if (this.panel) {
      this.reveal();
      return;
    }

    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      // Open as a new tab in the active editor group (next to the code files),
      // rather than splitting into a new column beside it.
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, ...this.extraResourceRoots],
      }
    );

    this.panel.webview.html = this.render(this.panel.webview, mediaRoot);

    this.panel.webview.onDidReceiveMessage(
      (raw) => this.handleMessage(raw),
      undefined,
      this.panelDisposables
    );
    this.panel.onDidChangeViewState(
      (e) => this.post({ type: "panel/visibility", visible: e.webviewPanel.visible }),
      undefined,
      this.panelDisposables
    );
    this.panel.onDidDispose(() => this.handleDispose(), undefined, this.panelDisposables);
  }

  /** Reveal the panel without stealing keyboard focus (product brief §10.4). */
  reveal(): void {
    this.panel?.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, true);
  }

  /** Close the panel; triggers `onClose` via the native dispose handler. */
  close(): void {
    this.panel?.dispose();
  }

  updateSession(session: SessionInfo): void {
    this.post({ type: "session/update", session });
  }

  renderMode(mode: ModeView): void {
    this.post({ type: "mode/render", mode });
  }

  sendModeList(modes: ModeView[], currentId?: string): void {
    this.post({ type: "modes/list", modes, currentId });
  }

  showConfig(config: ConfigView): void {
    this.post({ type: "config/show", config });
  }

  sendGameStats(gameId: string, best: number | null, plays: number): void {
    this.post({ type: "game/stats", gameId, best, plays });
  }

  sendMemeState(state: MemeStateView): void {
    this.post({ type: "meme/state", state });
  }

  sendVideoState(state: VideoStateView): void {
    this.post({ type: "video/state", state });
  }

  sendNewsState(state: NewsStateView): void {
    this.post({ type: "news/state", state });
  }

  sendLearningState(state: LearningStateView): void {
    this.post({ type: "learning/state", state });
  }

  sendLearningTopics(view: LearningTopicsView): void {
    this.post({ type: "learning/topics", view });
  }

  sendStats(stats: StatsView): void {
    this.post({ type: "stats/show", stats });
  }

  /** Convert a local file URI into a webview-loadable URI (panel must be open). */
  toWebviewUri(uri: vscode.Uri): string | undefined {
    return this.panel?.webview.asWebviewUri(uri).toString();
  }

  dispose(): void {
    this.close();
    this._onMessage.dispose();
    this._onClose.dispose();
  }

  private post(message: ExtensionToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private handleMessage(raw: unknown): void {
    if (!isWebviewToExtension(raw)) {
      return; // untrusted / malformed input — ignore silently
    }
    this._onMessage.fire(raw);
  }

  private handleDispose(): void {
    this.panel = undefined;
    while (this.panelDisposables.length) {
      this.panelDisposables.pop()?.dispose();
    }
    this._onClose.fire();
  }

  private render(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = getNonce();
    const csp = buildCsp(webview, nonce);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "waiting-room.js"));
    const audioUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "audio.js"));
    const gamesUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "games.js"));
    const ambientUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "ambient.js"));
    const physicalUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "physical.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "waiting-room.css"));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "icon.png"));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>${TITLE}</title>
</head>
<body>
  <div class="bt-app">
    <header class="bt-header">
      <div class="bt-brand"><img class="bt-logo" src="${iconUri}" alt="" />Between Trains</div>
      <nav id="bt-nav-primary" class="bt-nav bt-nav-primary" aria-label="Modes"></nav>
      <button id="bt-config" class="bt-icon-btn" title="Global config" aria-label="Global config">⚙</button>
    </header>
    <nav id="bt-nav-secondary" class="bt-nav bt-nav-secondary" aria-label="Options"></nav>
    <main id="bt-content" class="bt-content">
      <div class="bt-placeholder">
        <img class="bt-placeholder-logo" src="${iconUri}" alt="" />
        <p class="bt-placeholder-title">You're between trains.</p>
        <p class="bt-placeholder-sub">
          Modes arrive at the next stop. Sit tight, or press Stop to head back to your work.
        </p>
      </div>
    </main>
  </div>
  <script nonce="${nonce}" src="${audioUri}"></script>
  <script nonce="${nonce}" src="${gamesUri}"></script>
  <script nonce="${nonce}" src="${ambientUri}"></script>
  <script nonce="${nonce}" src="${physicalUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
