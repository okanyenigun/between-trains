/**
 * A mode is a small, disposable experience rendered inside the waiting room.
 * This descriptor is the registry-facing metadata; the actual interactive
 * rendering lives webview-side, keyed by `id` (see media/waiting-room.js), so
 * games/animation stay off the extension host.
 */
export type ModeCategory =
  | "microgame"
  | "ambient"
  | "learning"
  | "physical"
  | "media"
  | "news";

export interface WaitingModeDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: ModeCategory;
  readonly enabled: boolean;
  /** Needs the local Ollama brain (learning cards, etc.). */
  readonly requiresBrain?: boolean;
  /** Makes network calls (external content modes). */
  readonly requiresNetwork?: boolean;
}
