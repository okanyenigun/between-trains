import * as vscode from "vscode";
import { NewsService } from "../../news/NewsService";
import { NewsRecord } from "../../news/NewsLibrary";
import { NewsCardView } from "../../webview/protocol";
import { isNewsModeId, newsCategoryOf } from "../modeIds";
import { ModePresenterContext } from "./context";

/** Owns a news category mode: fetching, paging through cards, opening links. */
export class NewsPresenter {
  private index = 0;

  constructor(
    private readonly ctx: ModePresenterContext,
    private readonly news: NewsService
  ) {}

  category(): string {
    const id = this.ctx.currentModeId();
    return id ? newsCategoryOf(id) : "technology";
  }

  async open(): Promise<void> {
    this.index = 0;
    await this.pushState(true, true);
    const hasKey = await this.news.hasApiKey();
    if (hasKey && this.ctx.settings.newsAutoFetch && !this.news.getStatus().fetching) {
      void this.news.fetchBatch("auto", this.category());
    }
  }

  refresh(): void {
    void this.news.fetchBatch("manual", this.category());
  }

  async step(delta: number): Promise<void> {
    this.index += delta;
    await this.pushState(false, true);
  }

  /** Send the current news card + browse position; card at `index`. */
  async pushState(resetIndex: boolean, logShown: boolean): Promise<void> {
    if (!this.ctx.panel.isOpen || !isNewsModeId(this.ctx.currentModeId())) {
      return;
    }
    const category = this.category();
    const cards = await this.news.library.listByCategory(category);
    if (resetIndex) {
      this.index = 0;
    }
    const total = cards.length;
    this.index = total === 0 ? 0 : Math.max(0, Math.min(this.index, total - 1));
    const record: NewsRecord | undefined = cards[this.index];

    if (record && logShown) {
      this.ctx.metadata.record({
        type: "news_shown",
        sessionId: this.ctx.currentSessionId(),
        cardId: record.id,
        category,
      });
    }

    const status = this.news.getStatus();
    const hasApiKey = await this.news.hasApiKey();
    this.ctx.panel.sendNewsState({
      category,
      card: record
        ? {
            id: record.id,
            headline: record.headline,
            summary: record.summary,
            source: record.source,
            url: record.url,
            publishedAt: record.publishedAt,
            category,
          }
        : null,
      libraryList: cards.map(
        (c): NewsCardView => ({
          id: c.id,
          headline: c.headline,
          summary: c.summary,
          source: c.source,
          url: c.url,
          publishedAt: c.publishedAt,
          category,
        })
      ),
      index: this.index,
      total,
      fetching: status.fetching,
      savedThisRun: status.savedThisRun,
      autoFetch: this.ctx.settings.newsAutoFetch,
      hasApiKey,
      provider: this.news.provider(),
      lastFetch: status.lastResult
        ? {
            saved: status.lastResult.saved,
            ok: status.lastResult.ok,
            at: status.lastResult.at,
            error: status.lastResult.error,
          }
        : undefined,
    });
  }

  async openLink(id: string): Promise<void> {
    const cards = await this.news.library.listByCategory(this.category());
    const record = cards.find((c) => c.id === id);
    if (record && /^https?:\/\//i.test(record.url)) {
      this.ctx.metadata.record({
        type: "news_opened",
        sessionId: this.ctx.currentSessionId(),
        cardId: id,
      });
      void vscode.env.openExternal(vscode.Uri.parse(record.url));
    }
  }

  async setAutoFetch(value: boolean): Promise<void> {
    await this.ctx.settings.setNewsAutoFetch(value);
    this.ctx.logger.info(`News auto-fetch set to ${value}`);
    await this.pushState(false, false);
  }

  async clearLibrary(): Promise<void> {
    const category = this.category();
    if (!(await this.ctx.confirmClear(`all saved ${category} news cards`))) {
      return;
    }
    this.news.cancel();
    await this.news.library.clearCategory(category);
    this.index = 0;
    this.ctx.logger.info(`News library cleared (${category})`);
    await this.pushState(true, false);
  }
}
