import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { JsonLibrary } from "../storage/JsonLibrary";

/** Which video sub-mode a saved video belongs to. */
export type VideoKind = "random" | "programming";

/** A saved YouTube video. No media is downloaded — only metadata is stored. */
export interface VideoRecord {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  query: string;
  tags: string[];
  kind: VideoKind;
  savedAt: string;
  /** True once presented in the deck — each video is shown at most once there. */
  shown: boolean;
  shownAt?: string;
  liked: boolean | null;
  ratedAt?: string;
}

/** Older records may predate the kind field; default them to programming. */
function kindOf(record: VideoRecord): VideoKind {
  return record.kind === "random" ? "random" : "programming";
}

export interface VideoFeedbackSummary {
  total: number;
  likedCount: number;
  dislikedCount: number;
  likedTags: string[];
  dislikedTags: string[];
  likedChannels: string[];
  likedQueries: string[];
  dislikedQueries: string[];
}

let idCounter = 0;

function newRecordId(): string {
  idCounter += 1;
  return `v_${Date.now().toString(36)}_${idCounter}`;
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/**
 * Local, on-device library of saved YouTube videos under
 * `globalStorageUri/videos/library.json` (shared plumbing in {@link JsonLibrary}).
 * Metadata only (no downloads). Records are kept forever so the same video is
 * never re-saved or re-shown in the deck; liked videos remain for rewatching.
 */
export class VideoLibrary extends JsonLibrary<VideoRecord> {
  constructor(globalStorageUri: vscode.Uri, logger: OutputChannelLogger) {
    super(globalStorageUri, "videos", "videos", logger);
  }

  /** All saved video ids across every kind — used to avoid re-saving duplicates. */
  async knownVideoIds(): Promise<Set<string>> {
    return new Set((await this.records()).map((v) => v.videoId));
  }

  /** Pick a random not-yet-shown video of this kind, mark it shown, return it. */
  takeNextUnseen(kind: VideoKind): Promise<VideoRecord | undefined> {
    return this.enqueue(async () => {
      const videos = await this.records();
      const unseen = videos.filter((v) => !v.shown && kindOf(v) === kind);
      if (unseen.length === 0) {
        return undefined;
      }
      const chosen = unseen[Math.floor(Math.random() * unseen.length)];
      chosen.shown = true;
      chosen.shownAt = new Date().toISOString();
      await this.persist(videos);
      return chosen;
    });
  }

  async likedList(kind: VideoKind): Promise<VideoRecord[]> {
    return (await this.records())
      .filter((v) => v.liked === true && kindOf(v) === kind)
      .sort((a, b) => (b.ratedAt ?? b.savedAt).localeCompare(a.ratedAt ?? a.savedAt));
  }

  /** Every saved video of a kind, newest first — the browsable library. */
  async listByKind(kind: VideoKind): Promise<VideoRecord[]> {
    return (await this.records())
      .filter((v) => kindOf(v) === kind)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** Remove every saved video of a kind, leaving the other kind intact. */
  clearKind(kind: VideoKind): Promise<void> {
    return this.enqueue(async () => {
      const videos = await this.records();
      await this.persist(videos.filter((v) => kindOf(v) !== kind));
    });
  }

  async counts(
    kind: VideoKind
  ): Promise<{ total: number; unseen: number; liked: number; disliked: number }> {
    const ofKind = (await this.records()).filter((v) => kindOf(v) === kind);
    return {
      total: ofKind.length,
      unseen: ofKind.filter((v) => !v.shown).length,
      liked: ofKind.filter((v) => v.liked === true).length,
      disliked: ofKind.filter((v) => v.liked === false).length,
    };
  }

  addVideo(
    meta: Omit<VideoRecord, "id" | "savedAt" | "shown" | "liked">
  ): Promise<VideoRecord | undefined> {
    return this.enqueue(async () => {
      const videos = await this.records();
      if (videos.some((v) => v.videoId === meta.videoId)) {
        return undefined; // already saved
      }
      const record: VideoRecord = {
        ...meta,
        id: newRecordId(),
        savedAt: new Date().toISOString(),
        shown: false,
        liked: null,
      };
      videos.push(record);
      await this.persist(videos);
      return record;
    });
  }

  rate(id: string, liked: boolean): Promise<VideoRecord | undefined> {
    return this.enqueue(async () => {
      const videos = await this.records();
      const record = videos.find((v) => v.id === id);
      if (!record) {
        return undefined;
      }
      record.liked = liked;
      record.ratedAt = new Date().toISOString();
      await this.persist(videos);
      return record;
    });
  }

  async feedbackSummary(kind: VideoKind): Promise<VideoFeedbackSummary> {
    const videos = await this.records();
    const likedTags = new Map<string, number>();
    const dislikedTags = new Map<string, number>();
    const likedChannels = new Map<string, number>();
    const likedQueries = new Map<string, number>();
    const dislikedQueries = new Map<string, number>();

    for (const video of videos) {
      if (video.liked === null || kindOf(video) !== kind) {
        continue;
      }
      const tagBucket = video.liked ? likedTags : dislikedTags;
      const queryBucket = video.liked ? likedQueries : dislikedQueries;
      for (const tag of video.tags) {
        tagBucket.set(tag, (tagBucket.get(tag) ?? 0) + 1);
      }
      if (video.query) {
        queryBucket.set(video.query, (queryBucket.get(video.query) ?? 0) + 1);
      }
      if (video.liked && video.channel) {
        likedChannels.set(video.channel, (likedChannels.get(video.channel) ?? 0) + 1);
      }
    }

    const ofKind = videos.filter((v) => kindOf(v) === kind);
    return {
      total: ofKind.length,
      likedCount: ofKind.filter((v) => v.liked === true).length,
      dislikedCount: ofKind.filter((v) => v.liked === false).length,
      likedTags: topKeys(likedTags, 8),
      dislikedTags: topKeys(dislikedTags, 8),
      likedChannels: topKeys(likedChannels, 5),
      likedQueries: topKeys(likedQueries, 5),
      dislikedQueries: topKeys(dislikedQueries, 5),
    };
  }
}
