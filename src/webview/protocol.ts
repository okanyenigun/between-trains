/**
 * Typed message protocol between the extension host and the waiting-room
 * webview. All webview input is untrusted, so inbound messages are validated
 * with {@link isWebviewToExtension} before use.
 */

export interface SessionInfo {
  state: "inactive" | "maybeActive" | "active" | "finishing";
  /** Why the room is open, e.g. "Manual session". */
  activityLabel: string;
  modeId?: string;
  modeTitle?: string;
  /** Epoch ms when the session became active; drives the elapsed timer. */
  startedAt?: number;
}

/** The safe, trusted subset of a mode descriptor sent to the webview. */
export interface ModeView {
  id: string;
  title: string;
  description: string;
  category: string;
  requiresBrain?: boolean;
  requiresNetwork?: boolean;
}

/** Global brain configuration shown in the in-panel config view. */
export interface ConfigView {
  provider: string;
  providers: { id: string; label: string }[];
  model: string;
  models: string[];
  reachable: boolean;
  note?: string;
  /** News search provider + whether its API key is stored (never the key). */
  newsProvider: string;
  newsProviders: { id: string; label: string }[];
  newsKeySet: boolean;
}

/** One displayable GIF (uri is a webview-safe local file URI, never remote). */
export interface MemeGifView {
  id: string;
  uri: string;
  title: string;
  source: string;
}

/** Full state of the meme mode pushed to the webview. */
export interface MemeStateView {
  gif: MemeGifView | null;
  keptList: MemeGifView[];
  libraryList: MemeGifView[];
  total: number;
  available: number;
  liked: number;
  fetching: boolean;
  savedThisRun: number;
  autoFetch: boolean;
  fetchCount: number;
  lastFetch?: { saved: number; ok: boolean; at: string };
}

/** One saved YouTube video (only the id is sent — the webview builds the embed). */
export interface VideoView {
  id: string;
  videoId: string;
  title: string;
  channel: string;
}

/** Full state of the video mode pushed to the webview. */
export interface VideoStateView {
  current: VideoView | null;
  liked: VideoView[];
  library: VideoView[];
  total: number;
  unseen: number;
  likedCount: number;
  fetching: boolean;
  savedThisRun: number;
  autoFetch: boolean;
  fetchCount: number;
  lastFetch?: { saved: number; ok: boolean; at: string };
}

/** One news card shown in the news mode. */
export interface NewsCardView {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt?: string;
  category: string;
}

/** Full state of a news category pushed to the webview. */
export interface NewsStateView {
  category: string;
  card: NewsCardView | null;
  libraryList: NewsCardView[];
  index: number;
  total: number;
  fetching: boolean;
  savedThisRun: number;
  autoFetch: boolean;
  hasApiKey: boolean;
  provider: string;
  lastFetch?: { saved: number; ok: boolean; at: string; error?: string };
}

/** One generated learning card shown in a topic. */
export interface LearningCardView {
  id: string;
  title: string;
  body: string;
  example?: string;
  level: string;
  rating?: "known" | "unknown";
}

/** A user-defined learning topic (a dynamic sub-mode). */
export interface LearningTopicView {
  id: string;
  title: string;
  level: string;
}

/** Full state of one learning topic pushed to the webview. */
export interface LearningStateView {
  topicId: string;
  topicTitle: string;
  level: string;
  card: LearningCardView | null;
  libraryList: LearningCardView[];
  index: number;
  total: number;
  generating: boolean;
  savedThisRun: number;
  autoFetch: boolean;
  hasBrain: boolean;
  lastResult?: { saved: number; ok: boolean; at: string; error?: string };
}

/** The manage view: the list of topics the user has created. */
export interface LearningTopicsView {
  topics: LearningTopicView[];
  levels: { id: string; label: string }[];
}

/** Aggregated usage statistics for the stats screen. */
export interface StatsView {
  enabled: boolean;
  events: number;
  sessions: number;
  totalActiveMs: number;
  firstAt?: string;
  lastAt?: string;
  topModes: { label: string; count: number }[];
  games: { label: string; plays: number; best: number }[];
  memes: { saved: number; liked: number; disliked: number };
  videos: { saved: number; liked: number };
  news: { saved: number; opened: number };
  learning: { saved: number; known: number; unknown: number };
}

/** Extension → webview. */
export type ExtensionToWebview =
  | { type: "session/update"; session: SessionInfo }
  | { type: "panel/visibility"; visible: boolean }
  | { type: "mode/render"; mode: ModeView }
  | { type: "modes/list"; modes: ModeView[]; currentId?: string }
  | { type: "config/show"; config: ConfigView }
  | { type: "stats/show"; stats: StatsView }
  | { type: "learning/state"; state: LearningStateView }
  | { type: "learning/topics"; view: LearningTopicsView }
  | { type: "game/stats"; gameId: string; best: number | null; plays: number }
  | { type: "meme/state"; state: MemeStateView }
  | { type: "video/state"; state: VideoStateView }
  | { type: "news/state"; state: NewsStateView };

/** Webview → extension. */
export type WebviewToExtension =
  | { type: "panel/ready" }
  | { type: "session/stop" }
  | { type: "mode/select"; id: string }
  | { type: "config/open" }
  | { type: "config/close" }
  | { type: "config/refreshModels" }
  | { type: "config/setProvider"; value: string }
  | { type: "config/setModel"; value: string }
  | { type: "config/setNewsProvider"; value: string }
  | { type: "config/setNewsApiKey" }
  | { type: "config/clearNewsApiKey" }
  | { type: "config/openKeybindings" }
  | { type: "config/openStats" }
  | { type: "config/openStorage" }
  | { type: "game/started"; gameId: string }
  | { type: "game/completed"; gameId: string; score?: number }
  | { type: "game/statsRequest"; gameId: string }
  | { type: "meme/next" }
  | { type: "meme/rate"; id: string; liked: boolean }
  | { type: "meme/fetchNow" }
  | { type: "meme/setAutoFetch"; value: boolean }
  | { type: "meme/clearLibrary" }
  | { type: "video/next" }
  | { type: "video/rate"; id: string; liked: boolean }
  | { type: "video/replay"; id: string }
  | { type: "video/openExternal"; videoId: string }
  | { type: "video/fetchNow" }
  | { type: "video/setAutoFetch"; value: boolean }
  | { type: "video/clearLibrary" }
  | { type: "news/next" }
  | { type: "news/prev" }
  | { type: "news/refresh" }
  | { type: "news/openLink"; id: string }
  | { type: "news/setAutoFetch"; value: boolean }
  | { type: "news/clearLibrary" }
  | { type: "learning/next" }
  | { type: "learning/prev" }
  | { type: "learning/rate"; id: string; known: boolean }
  | { type: "learning/generate" }
  | { type: "learning/setAutoFetch"; value: boolean }
  | { type: "learning/clearLibrary" }
  | { type: "learning/addTopic" }
  | { type: "learning/removeTopic"; id: string };

const INBOUND_TYPES: ReadonlySet<string> = new Set([
  "panel/ready",
  "session/stop",
  "mode/select",
  "config/open",
  "config/close",
  "config/refreshModels",
  "config/setProvider",
  "config/setModel",
  "config/setNewsProvider",
  "config/setNewsApiKey",
  "config/clearNewsApiKey",
  "config/openKeybindings",
  "config/openStats",
  "config/openStorage",
  "game/started",
  "game/completed",
  "game/statsRequest",
  "meme/next",
  "meme/rate",
  "meme/fetchNow",
  "meme/setAutoFetch",
  "meme/clearLibrary",
  "video/next",
  "video/rate",
  "video/replay",
  "video/openExternal",
  "video/fetchNow",
  "video/setAutoFetch",
  "video/clearLibrary",
  "news/next",
  "news/prev",
  "news/refresh",
  "news/openLink",
  "news/setAutoFetch",
  "news/clearLibrary",
  "learning/next",
  "learning/prev",
  "learning/rate",
  "learning/generate",
  "learning/setAutoFetch",
  "learning/clearLibrary",
  "learning/addTopic",
  "learning/removeTopic",
]);

/** Inbound message types that must carry a string `id`. */
const REQUIRES_ID: ReadonlySet<string> = new Set([
  "mode/select",
  "news/openLink",
  "learning/removeTopic",
]);
/** Inbound message types that must carry a string `value`. */
const REQUIRES_VALUE: ReadonlySet<string> = new Set([
  "config/setProvider",
  "config/setModel",
  "config/setNewsProvider",
]);

export function isWebviewToExtension(value: unknown): value is WebviewToExtension {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !INBOUND_TYPES.has(type)) {
    return false;
  }
  if (REQUIRES_ID.has(type)) {
    return typeof (value as { id?: unknown }).id === "string";
  }
  if (REQUIRES_VALUE.has(type)) {
    return typeof (value as { value?: unknown }).value === "string";
  }
  if (
    type === "game/started" ||
    type === "game/completed" ||
    type === "game/statsRequest"
  ) {
    if (typeof (value as { gameId?: unknown }).gameId !== "string") {
      return false;
    }
    if (type === "game/completed") {
      const score = (value as { score?: unknown }).score;
      return score === undefined || (typeof score === "number" && Number.isFinite(score));
    }
    return true;
  }
  if (type === "meme/rate" || type === "video/rate") {
    return (
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { liked?: unknown }).liked === "boolean"
    );
  }
  if (type === "learning/rate") {
    return (
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { known?: unknown }).known === "boolean"
    );
  }
  if (type === "video/replay") {
    return typeof (value as { id?: unknown }).id === "string";
  }
  if (type === "video/openExternal") {
    return typeof (value as { videoId?: unknown }).videoId === "string";
  }
  if (
    type === "meme/setAutoFetch" ||
    type === "video/setAutoFetch" ||
    type === "news/setAutoFetch" ||
    type === "learning/setAutoFetch"
  ) {
    return typeof (value as { value?: unknown }).value === "boolean";
  }
  return true;
}
