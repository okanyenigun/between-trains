import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { Settings } from "../config/Settings";
import { PreferenceStore } from "./PreferenceStore";
import {
  GameScore,
  GameScores,
  InteractionEvent,
  InteractionEventInput,
  MetadataStats,
  ModeStats,
  applyEventToStats,
  applyScore,
  buildEvent,
  emptyGameScores,
  emptyModeStats,
} from "./schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface MetadataExport {
  exportedAt: string;
  lastModeId?: string;
  modeStats?: ModeStats;
  gameScores?: GameScores;
  sessions: Record<string, unknown[]>;
}

/**
 * Single high-level API for local, on-device metadata (product brief §14).
 * Modes and the controller emit structured events here; they never touch files
 * directly. All I/O goes through `vscode.workspace.fs` (works on the extension
 * host, including remote/WSL/containers) — no hardcoded OS paths.
 *
 * Layout under the extension's `globalStorageUri`:
 *   sessions/YYYY-MM-DD.jsonl   append-only interaction traces
 *   profile/mode-stats.json     aggregated usage stats
 *   cache/                      generated content cache (later milestones)
 *
 * Writes are serialized through a single chain to avoid in-process races.
 */
export class MetadataService {
  private readonly sessionsDir: vscode.Uri;
  private readonly profileDir: vscode.Uri;
  private readonly cacheDir: vscode.Uri;
  private readonly modeStatsUri: vscode.Uri;
  private readonly gameScoresUri: vscode.Uri;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly base: vscode.Uri,
    private readonly settings: Settings,
    private readonly prefs: PreferenceStore,
    private readonly logger: OutputChannelLogger
  ) {
    this.sessionsDir = vscode.Uri.joinPath(base, "sessions");
    this.profileDir = vscode.Uri.joinPath(base, "profile");
    this.cacheDir = vscode.Uri.joinPath(base, "cache");
    this.modeStatsUri = vscode.Uri.joinPath(this.profileDir, "mode-stats.json");
    this.gameScoresUri = vscode.Uri.joinPath(this.profileDir, "game-scores.json");
  }

  get storageUri(): vscode.Uri {
    return this.base;
  }

  /** Record an interaction event. No-op when local metadata is disabled. */
  record(input: InteractionEventInput): void {
    if (!this.settings.metadataEnabled) {
      return;
    }
    const event = buildEvent(input);
    this.enqueue(() => this.persist(event)).catch((error) =>
      this.logger.error("Failed to record metadata event", error)
    );
  }

  /** Read the durable high-score record for a game (undefined if never played). */
  getGameScore(gameId: string): Promise<GameScore | undefined> {
    return this.enqueue(async () => {
      const scores = await this.readJson<GameScores>(this.gameScoresUri);
      return scores?.games[gameId];
    });
  }

  /**
   * Record a game result, updating the durable best/plays. No-op (returns
   * undefined) when local metadata is disabled.
   */
  recordGameScore(gameId: string, score: number): Promise<GameScore | undefined> {
    if (!this.settings.metadataEnabled) {
      return Promise.resolve(undefined);
    }
    return this.enqueue(async () => {
      const current = (await this.readJson<GameScores>(this.gameScoresUri)) ?? emptyGameScores();
      const next = applyScore(current, gameId, score, new Date().toISOString());
      await this.ensureDir(this.profileDir);
      await this.writeJson(this.gameScoresUri, next);
      return next.games[gameId];
    });
  }

  async pruneOldSessions(retentionDays: number): Promise<void> {
    return this.enqueue(async () => {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(this.sessionsDir);
      } catch {
        return; // no sessions dir yet
      }
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File || !name.endsWith(".jsonl")) {
          continue;
        }
        const day = Date.parse(name.slice(0, 10));
        if (!Number.isNaN(day) && day < cutoff) {
          await this.deletePath(vscode.Uri.joinPath(this.sessionsDir, name));
          this.logger.info(`Pruned old session file: ${name}`);
        }
      }
    });
  }

  clearSessionHistory(): Promise<void> {
    return this.enqueue(() => this.deletePath(this.sessionsDir));
  }

  clearGeneratedContentCache(): Promise<void> {
    return this.enqueue(() => this.deletePath(this.cacheDir));
  }

  resetPersonalization(): Promise<void> {
    return this.enqueue(async () => {
      await this.deletePath(this.profileDir);
      await this.prefs.clearLastModeId();
    });
  }

  clearAll(): Promise<void> {
    return this.enqueue(async () => {
      await this.deletePath(this.sessionsDir);
      await this.deletePath(this.profileDir);
      await this.deletePath(this.cacheDir);
      await this.prefs.clearLastModeId();
    });
  }

  /** Ensure the storage folder exists and return its URI (for reveal). */
  revealUri(): Promise<vscode.Uri> {
    return this.enqueue(async () => {
      await this.ensureDir(this.base);
      return this.base;
    });
  }

  /** Aggregate the local records into usage statistics for the stats screen. */
  buildStats(): Promise<MetadataStats> {
    return this.enqueue(async () => {
      const modeStats = (await this.readJson<ModeStats>(this.modeStatsUri)) ?? emptyModeStats();
      const gameScores = (await this.readJson<GameScores>(this.gameScoresUri)) ?? emptyGameScores();

      let events = 0;
      let totalActiveMs = 0;
      let firstAt: string | undefined;
      let lastAt: string | undefined;
      const c = {
        gifSaved: 0,
        gifLiked: 0,
        gifDisliked: 0,
        videoSaved: 0,
        videoLiked: 0,
        newsSaved: 0,
        newsOpened: 0,
        learningSaved: 0,
        learningKnown: 0,
        learningUnknown: 0,
      };

      try {
        const entries = await vscode.workspace.fs.readDirectory(this.sessionsDir);
        for (const [name, type] of entries) {
          if (type !== vscode.FileType.File || !name.endsWith(".jsonl")) {
            continue;
          }
          const text = await this.readText(vscode.Uri.joinPath(this.sessionsDir, name));
          for (const line of text.split("\n")) {
            if (!line) {
              continue;
            }
            const parsed = this.safeParse(line);
            if (!parsed || typeof parsed !== "object") {
              continue;
            }
            const e = parsed as InteractionEvent;
            events += 1;
            if (typeof e.timestamp === "string") {
              if (!firstAt || e.timestamp < firstAt) {
                firstAt = e.timestamp;
              }
              if (!lastAt || e.timestamp > lastAt) {
                lastAt = e.timestamp;
              }
            }
            switch (e.type) {
              case "session_ended":
                totalActiveMs += typeof e.durationMs === "number" ? e.durationMs : 0;
                break;
              case "gif_saved":
                c.gifSaved += 1;
                break;
              case "gif_rated":
                if (e.liked) {
                  c.gifLiked += 1;
                } else {
                  c.gifDisliked += 1;
                }
                break;
              case "video_saved":
                c.videoSaved += 1;
                break;
              case "video_rated":
                if (e.liked) {
                  c.videoLiked += 1;
                }
                break;
              case "news_saved":
                c.newsSaved += 1;
                break;
              case "news_opened":
                c.newsOpened += 1;
                break;
              case "learning_card_saved":
                c.learningSaved += 1;
                break;
              case "learning_card_rated":
                if (e.known) {
                  c.learningKnown += 1;
                } else {
                  c.learningUnknown += 1;
                }
                break;
            }
          }
        }
      } catch {
        // no sessions yet
      }

      const topModes = Object.entries(modeStats.perMode)
        .map(([modeId, s]) => ({ modeId, count: s.selections }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      const games = Object.entries(gameScores.games)
        .map(([gameId, g]) => ({ gameId, plays: g.plays, best: g.best }))
        .sort((a, b) => b.plays - a.plays);

      return {
        enabled: this.settings.metadataEnabled,
        events,
        sessions: modeStats.totalSessions,
        totalActiveMs,
        firstAt,
        lastAt,
        topModes,
        games,
        memes: { saved: c.gifSaved, liked: c.gifLiked, disliked: c.gifDisliked },
        videos: { saved: c.videoSaved, liked: c.videoLiked },
        news: { saved: c.newsSaved, opened: c.newsOpened },
        learning: { saved: c.learningSaved, known: c.learningKnown, unknown: c.learningUnknown },
      };
    });
  }

  buildExport(): Promise<MetadataExport> {
    return this.enqueue(async () => {
      const sessions: Record<string, unknown[]> = {};
      try {
        const entries = await vscode.workspace.fs.readDirectory(this.sessionsDir);
        for (const [name, type] of entries) {
          if (type !== vscode.FileType.File || !name.endsWith(".jsonl")) {
            continue;
          }
          const text = await this.readText(vscode.Uri.joinPath(this.sessionsDir, name));
          sessions[name] = text
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => this.safeParse(line));
        }
      } catch {
        // no sessions yet
      }
      return {
        exportedAt: new Date().toISOString(),
        lastModeId: this.prefs.getLastModeId(),
        modeStats: await this.readJson<ModeStats>(this.modeStatsUri),
        gameScores: await this.readJson<GameScores>(this.gameScoresUri),
        sessions,
      };
    });
  }

  // --- internals ------------------------------------------------------------

  private async persist(event: InteractionEvent): Promise<void> {
    await this.appendEvent(event);
    await this.updateStats(event);
  }

  private async appendEvent(event: InteractionEvent): Promise<void> {
    await this.ensureDir(this.sessionsDir);
    const fileName = `${event.timestamp.slice(0, 10)}.jsonl`;
    const uri = vscode.Uri.joinPath(this.sessionsDir, fileName);
    const existing = await this.readText(uri);
    const data = existing + JSON.stringify(event) + "\n";
    await vscode.workspace.fs.writeFile(uri, encoder.encode(data));
  }

  private async updateStats(event: InteractionEvent): Promise<void> {
    if (event.type !== "session_started" && event.type !== "mode_selected") {
      return;
    }
    const current = (await this.readJson<ModeStats>(this.modeStatsUri)) ?? emptyModeStats();
    const next = applyEventToStats(current, event);
    await this.ensureDir(this.profileDir);
    await this.writeJson(this.modeStatsUri, next);
  }

  /** Serialize all reads/writes so appends never interleave in-process. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureDir(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri);
  }

  private async readText(uri: vscode.Uri): Promise<string> {
    try {
      return decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return "";
    }
  }

  private async readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
    const text = await this.readText(uri);
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  private async writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, encoder.encode(JSON.stringify(value, null, 2)));
  }

  private async deletePath(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch {
      // already gone — nothing to do
    }
  }

  private safeParse(line: string): unknown {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  }
}
