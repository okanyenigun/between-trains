/**
 * Versioned, timestamped schemas for local metadata. Events are append-only
 * behavior traces — they must never contain raw source code, prompts, or file
 * contents (product brief §14.5). Pure and framework-free so they can be unit
 * tested without `vscode`.
 */

export const INTERACTION_SCHEMA_VERSION = 1;
export const MODE_STATS_VERSION = 1;
export const GAME_SCORES_VERSION = 1;

/** Event payloads as emitted by callers (version + timestamp added on record). */
export type InteractionEventInput =
  | { type: "session_started"; sessionId: string; trigger: string }
  | { type: "session_ended"; sessionId: string; reason: string; durationMs: number }
  | { type: "mode_selected"; sessionId: string; modeId: string }
  | { type: "mode_skipped"; sessionId: string; modeId: string }
  | { type: "panel_closed"; sessionId: string; reason: string }
  | { type: "microgame_started"; sessionId: string; gameId: string }
  | { type: "microgame_completed"; sessionId: string; gameId: string; score?: number }
  | { type: "gif_fetch_started"; trigger: string; target: number }
  | { type: "gif_fetch_completed"; saved: number; ok: boolean; via: string }
  | { type: "gif_saved"; gifId: string; source: string; tags: string[] }
  | { type: "gif_shown"; sessionId?: string; gifId: string }
  | { type: "gif_rated"; sessionId?: string; gifId: string; liked: boolean }
  | { type: "video_fetch_started"; trigger: string; target: number }
  | { type: "video_fetch_completed"; saved: number; ok: boolean; via: string }
  | { type: "video_saved"; videoId: string; channel: string; tags: string[] }
  | { type: "video_shown"; sessionId?: string; videoId: string }
  | { type: "video_rated"; sessionId?: string; videoId: string; liked: boolean }
  | { type: "video_replayed"; sessionId?: string; videoId: string }
  | { type: "news_fetch_started"; trigger: string; target: number }
  | { type: "news_fetch_completed"; saved: number; ok: boolean; via: string }
  | { type: "news_saved"; category: string; source: string }
  | { type: "news_shown"; sessionId?: string; cardId: string; category: string }
  | { type: "news_opened"; sessionId?: string; cardId: string }
  | { type: "learning_generate_started"; trigger: string; target: number }
  | { type: "learning_generate_completed"; saved: number; ok: boolean }
  | { type: "learning_card_saved"; topicId: string }
  | { type: "learning_card_shown"; sessionId?: string; cardId: string; topicId: string }
  | { type: "learning_card_rated"; sessionId?: string; cardId: string; known: boolean }
  | { type: "error"; sessionId?: string; message: string };

export type InteractionEvent = InteractionEventInput & { v: number; timestamp: string };

export function buildEvent(
  input: InteractionEventInput,
  timestamp: string = new Date().toISOString()
): InteractionEvent {
  return { v: INTERACTION_SCHEMA_VERSION, timestamp, ...input } as InteractionEvent;
}

/** Aggregated, non-reversible usage stats used later for personalization. */
export interface ModeStat {
  selections: number;
  lastUsed: string;
}

export interface ModeStats {
  v: number;
  totalSessions: number;
  perMode: Record<string, ModeStat>;
}

export function emptyModeStats(): ModeStats {
  return { v: MODE_STATS_VERSION, totalSessions: 0, perMode: {} };
}

/** Pure reducer: fold an event into the aggregate stats. */
export function applyEventToStats(stats: ModeStats, event: InteractionEvent): ModeStats {
  const next: ModeStats = {
    v: stats.v,
    totalSessions: stats.totalSessions,
    perMode: { ...stats.perMode },
  };

  if (event.type === "session_started") {
    next.totalSessions += 1;
  } else if (event.type === "mode_selected") {
    const prev = next.perMode[event.modeId] ?? { selections: 0, lastUsed: event.timestamp };
    next.perMode[event.modeId] = {
      selections: prev.selections + 1,
      lastUsed: event.timestamp,
    };
  }

  return next;
}

/** Aggregated usage statistics computed from the local records (for the UI). */
export interface MetadataStats {
  enabled: boolean;
  events: number;
  sessions: number;
  totalActiveMs: number;
  firstAt?: string;
  lastAt?: string;
  topModes: { modeId: string; count: number }[];
  games: { gameId: string; plays: number; best: number }[];
  memes: { saved: number; liked: number; disliked: number };
  videos: { saved: number; liked: number };
  news: { saved: number; opened: number };
  learning: { saved: number; known: number; unknown: number };
}

/** Durable per-game high-score record (higher is better for both games). */
export interface GameScore {
  best: number;
  lastScore: number;
  plays: number;
  updatedAt: string;
}

export interface GameScores {
  v: number;
  games: Record<string, GameScore>;
}

export function emptyGameScores(): GameScores {
  return { v: GAME_SCORES_VERSION, games: {} };
}

/** Pure reducer: fold a new score into the durable scores, updating best/plays. */
export function applyScore(
  scores: GameScores,
  gameId: string,
  score: number,
  timestamp: string
): GameScores {
  const prev = scores.games[gameId];
  return {
    v: scores.v,
    games: {
      ...scores.games,
      [gameId]: {
        best: prev ? Math.max(prev.best, score) : score,
        lastScore: score,
        plays: (prev?.plays ?? 0) + 1,
        updatedAt: timestamp,
      },
    },
  };
}

/** Generate a compact, human-readable session id: `s_YYYYMMDD_HHMMSS_rand`. */
export function newSessionId(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `s_${stamp}_${rand}`;
}
