import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { JsonLibrary } from "../storage/JsonLibrary";

/** A stored news card. Rendered as plain text only. */
export interface NewsRecord {
  id: string;
  category: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt?: string;
  savedAt: string;
}

let idCounter = 0;

function newCardId(): string {
  idCounter += 1;
  return `n_${Date.now().toString(36)}_${idCounter}`;
}

/**
 * Local, on-device store of fetched news cards under
 * `globalStorageUri/news/library.json` (shared plumbing in {@link JsonLibrary}).
 * Metadata only; cards are grouped by category and shown newest-first.
 */
export class NewsLibrary extends JsonLibrary<NewsRecord> {
  constructor(globalStorageUri: vscode.Uri, logger: OutputChannelLogger) {
    super(globalStorageUri, "news", "cards", logger);
  }

  /** Known article URLs for a category — used to avoid saving duplicates. */
  async knownUrls(category: string): Promise<Set<string>> {
    return new Set(
      (await this.records()).filter((c) => c.category === category).map((c) => c.url)
    );
  }

  /** Cards for a category, newest first. */
  async listByCategory(category: string): Promise<NewsRecord[]> {
    return (await this.records())
      .filter((c) => c.category === category)
      .sort((a, b) => (b.publishedAt ?? b.savedAt).localeCompare(a.publishedAt ?? a.savedAt));
  }

  addCard(meta: Omit<NewsRecord, "id" | "savedAt">): Promise<NewsRecord | undefined> {
    return this.enqueue(async () => {
      const cards = await this.records();
      if (cards.some((c) => c.category === meta.category && c.url === meta.url)) {
        return undefined; // already saved for this category
      }
      const record: NewsRecord = { ...meta, id: newCardId(), savedAt: new Date().toISOString() };
      cards.push(record);
      await this.persist(cards);
      return record;
    });
  }

  /** Remove every saved card in a category, leaving other categories intact. */
  clearCategory(category: string): Promise<void> {
    return this.enqueue(async () => {
      const cards = await this.records();
      await this.persist(cards.filter((c) => c.category !== category));
    });
  }
}
