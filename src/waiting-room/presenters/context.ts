import { OutputChannelLogger } from "../../logging/OutputChannelLogger";
import { Settings } from "../../config/Settings";
import { MetadataService } from "../../metadata/MetadataService";
import { WebviewPanelManager } from "../../webview/WebviewPanelManager";

/**
 * The slice of controller state and services a per-mode presenter needs. The
 * controller still owns the session lifecycle and the "which mode is current"
 * question; presenters read those through getters (they change over time) and
 * push their own content to the panel.
 */
export interface ModePresenterContext {
  readonly panel: WebviewPanelManager;
  readonly settings: Settings;
  readonly metadata: MetadataService;
  readonly logger: OutputChannelLogger;
  /** The id of the mode currently selected, or undefined. */
  currentModeId(): string | undefined;
  /** The active session id, or undefined when no session is live. */
  currentSessionId(): string | undefined;
  /** Modal confirmation before a destructive library wipe. */
  confirmClear(what: string): Promise<boolean>;
  /** Switch to a mode by id (persists it as the last-used mode). */
  setMode(id: string): void;
}
