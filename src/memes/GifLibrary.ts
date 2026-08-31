import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { JsonLibrary } from "../storage/JsonLibrary";

/** Metadata stored for every saved GIF. Rated GIFs keep their record forever
 * (so disliked ones are never re-downloaded), but a dislike deletes the file. */
export interface GifRecord {
  id: string;
  fileName: string;
  source: "tenor" | "giphy";
  mediaUrl: string;
  title: string;
  query: string;
  tags: string[];
  savedAt: string;
  sizeBytes: number;
  liked: boolean | null;
  ratedAt?: string;
}

/** Compact preference summary derived from ratings — the analyzer tool's data. */
export interface GifFeedbackSummary {
  total: number;
  likedCount: number;
  dislikedCount: number;
  unratedCount: number;
  likedTags: string[];
  dislikedTags: string[];
  likedQueries: string[];
  dislikedQueries: string[];
}

let idCounter = 0;

function newGifId(): string {
  idCounter += 1;
  return `g_${Date.now().toString(36)}_${idCounter}`;
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/**
 * Local, on-device GIF library under `globalStorageUri/gifs/`: the .gif files
 * plus a `library.json` metadata index (shared plumbing in {@link JsonLibrary}).
 * The webview receives files via `asWebviewUri` — never remote URLs.
 */
export class GifLibrary extends JsonLibrary<GifRecord> {
  constructor(globalStorageUri: vscode.Uri, logger: OutputChannelLogger) {
    super(globalStorageUri, "gifs", "gifs", logger);
  }

  /** Root folder holding the gif files — needed for webview resource roots. */
  get rootUri(): vscode.Uri {
    return this.dir;
  }

  fileUri(record: GifRecord): vscode.Uri {
    return vscode.Uri.joinPath(this.dir, record.fileName);
  }

  async list(): Promise<GifRecord[]> {
    return [...(await this.records())];
  }

  /** GIFs eligible for display: everything except explicit dislikes. */
  async displayPool(): Promise<GifRecord[]> {
    return (await this.records()).filter((g) => g.liked !== false);
  }

  /** Kept (liked) GIFs, newest first — their files are retained for re-display. */
  async likedList(): Promise<GifRecord[]> {
    return (await this.records())
      .filter((g) => g.liked === true)
      .sort((a, b) => (b.ratedAt ?? b.savedAt).localeCompare(a.ratedAt ?? a.savedAt));
  }

  /** Every media URL ever saved — used to avoid re-downloading (incl. dislikes). */
  async knownUrls(): Promise<Set<string>> {
    return new Set((await this.records()).map((g) => g.mediaUrl));
  }

  async randomGif(excludeId?: string): Promise<GifRecord | undefined> {
    const pool = await this.displayPool();
    const candidates = pool.length > 1 ? pool.filter((g) => g.id !== excludeId) : pool;
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  async counts(): Promise<{ total: number; available: number; liked: number; disliked: number }> {
    const gifs = await this.records();
    const disliked = gifs.filter((g) => g.liked === false).length;
    const liked = gifs.filter((g) => g.liked === true).length;
    return {
      total: gifs.length,
      available: gifs.length - disliked,
      liked,
      disliked,
    };
  }

  /** Save a downloaded GIF: write the file, then append its metadata record. */
  addGif(
    meta: Omit<GifRecord, "id" | "fileName" | "savedAt" | "sizeBytes" | "liked">,
    data: Uint8Array
  ): Promise<GifRecord> {
    return this.enqueue(async () => {
      const gifs = await this.records();
      const id = newGifId();
      const record: GifRecord = {
        ...meta,
        id,
        fileName: `${id}.gif`,
        savedAt: new Date().toISOString(),
        sizeBytes: data.byteLength,
        liked: null,
      };
      await vscode.workspace.fs.createDirectory(this.dir);
      await vscode.workspace.fs.writeFile(this.fileUri(record), data);
      gifs.push(record);
      await this.persist(gifs);
      return record;
    });
  }

  /** Rate a GIF. Dislikes delete the binary but keep the metadata record. */
  rate(id: string, liked: boolean): Promise<GifRecord | undefined> {
    return this.enqueue(async () => {
      const gifs = await this.records();
      const record = gifs.find((g) => g.id === id);
      if (!record) {
        return undefined;
      }
      record.liked = liked;
      record.ratedAt = new Date().toISOString();
      if (!liked) {
        try {
          await vscode.workspace.fs.delete(this.fileUri(record), { useTrash: false });
        } catch {
          // file already gone — the record is what matters
        }
      }
      await this.persist(gifs);
      return record;
    });
  }

  /** Aggregate ratings into a compact preference summary (bounded output). */
  async feedbackSummary(): Promise<GifFeedbackSummary> {
    const gifs = await this.records();
    const likedTags = new Map<string, number>();
    const dislikedTags = new Map<string, number>();
    const likedQueries = new Map<string, number>();
    const dislikedQueries = new Map<string, number>();

    for (const gif of gifs) {
      if (gif.liked === null) {
        continue;
      }
      const tagBucket = gif.liked ? likedTags : dislikedTags;
      const queryBucket = gif.liked ? likedQueries : dislikedQueries;
      for (const tag of gif.tags) {
        tagBucket.set(tag, (tagBucket.get(tag) ?? 0) + 1);
      }
      if (gif.query) {
        queryBucket.set(gif.query, (queryBucket.get(gif.query) ?? 0) + 1);
      }
    }

    const disliked = gifs.filter((g) => g.liked === false).length;
    const liked = gifs.filter((g) => g.liked === true).length;
    return {
      total: gifs.length,
      likedCount: liked,
      dislikedCount: disliked,
      unratedCount: gifs.length - liked - disliked,
      likedTags: topKeys(likedTags, 8),
      dislikedTags: topKeys(dislikedTags, 8),
      likedQueries: topKeys(likedQueries, 5),
      dislikedQueries: topKeys(dislikedQueries, 5),
    };
  }
}
