import { MemeService } from "../../memes/MemeService";
import { GifRecord } from "../../memes/GifLibrary";
import { MemeGifView } from "../../webview/protocol";
import { MEME_MODE_ID } from "../modeIds";
import { ModePresenterContext } from "./context";

/** Owns the meme mode: showing gifs, rating, auto-fetch, and clearing. */
export class MemePresenter {
  private currentGifId?: string;

  constructor(
    private readonly ctx: ModePresenterContext,
    private readonly memes: MemeService
  ) {}

  /** Entering the meme mode: show a gif and auto-fetch if configured. */
  async open(): Promise<void> {
    await this.pushState(true);
    if (this.ctx.settings.memesAutoFetch && !this.memes.getStatus().fetching) {
      void this.memes.fetchBatch("auto");
    }
  }

  /** Push the meme mode's full state; `advance` picks the next random gif. */
  async pushState(advance: boolean): Promise<void> {
    if (!this.ctx.panel.isOpen || this.ctx.currentModeId() !== MEME_MODE_ID) {
      return;
    }
    const library = this.memes.library;
    let gifView: { id: string; uri: string; title: string; source: string } | null = null;

    if (advance) {
      const record = await library.randomGif(this.currentGifId);
      this.currentGifId = record?.id;
      if (record && record.id) {
        this.ctx.metadata.record({
          type: "gif_shown",
          sessionId: this.ctx.currentSessionId(),
          gifId: record.id,
        });
      }
    }
    if (this.currentGifId) {
      const pool = await library.displayPool();
      const record = pool.find((g) => g.id === this.currentGifId);
      if (record) {
        const uri = this.ctx.panel.toWebviewUri(library.fileUri(record));
        if (uri) {
          gifView = { id: record.id, uri, title: record.title, source: record.source };
        }
      }
    }

    const toMemeViews = (records: GifRecord[]): MemeGifView[] => {
      const out: MemeGifView[] = [];
      for (const record of records) {
        const uri = this.ctx.panel.toWebviewUri(library.fileUri(record));
        if (uri) {
          out.push({ id: record.id, uri, title: record.title, source: record.source });
        }
      }
      return out;
    };
    const keptList = toMemeViews(await library.likedList());
    const libraryList = toMemeViews(await library.displayPool());

    const counts = await library.counts();
    const status = this.memes.getStatus();
    this.ctx.panel.sendMemeState({
      gif: gifView,
      keptList,
      libraryList,
      total: counts.total,
      available: counts.available,
      liked: counts.liked,
      fetching: status.fetching,
      savedThisRun: status.savedThisRun,
      autoFetch: this.ctx.settings.memesAutoFetch,
      fetchCount: this.ctx.settings.memesFetchCount,
      lastFetch: status.lastResult
        ? { saved: status.lastResult.saved, ok: status.lastResult.ok, at: status.lastResult.at }
        : undefined,
    });
  }

  fetchNow(): void {
    void this.memes.fetchBatch("manual");
  }

  async rate(id: string, liked: boolean): Promise<void> {
    this.ctx.metadata.record({
      type: "gif_rated",
      sessionId: this.ctx.currentSessionId(),
      gifId: id,
      liked,
    });
    await this.memes.library.rate(id, liked);
    this.ctx.logger.info(`Gif ${liked ? "liked" : "disliked"}: ${id}`);
    await this.pushState(true);
  }

  async setAutoFetch(value: boolean): Promise<void> {
    await this.ctx.settings.setMemesAutoFetch(value);
    this.ctx.logger.info(`Meme auto-fetch set to ${value}`);
    await this.pushState(false);
  }

  async clearLibrary(): Promise<void> {
    if (!(await this.ctx.confirmClear("all saved memes & GIFs"))) {
      return;
    }
    this.memes.cancel();
    await this.memes.library.clearAll();
    this.currentGifId = undefined;
    this.ctx.logger.info("Meme library cleared");
    await this.pushState(true);
  }
}
