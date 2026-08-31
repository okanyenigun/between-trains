import * as vscode from "vscode";
import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { JsonLibrary } from "../storage/JsonLibrary";

/** How the learner rated a card. `unknown` = "didn't know it" (a weak spot). */
export type LearningRating = "known" | "unknown";

/** A stored learning card for a topic. Rendered as plain text only. */
export interface LearningCardRecord {
  id: string;
  topicId: string;
  title: string;
  body: string;
  example?: string;
  savedAt: string;
  rating?: LearningRating;
  ratedAt?: string;
}

let idCounter = 0;

function newCardId(): string {
  idCounter += 1;
  return `l_${Date.now().toString(36)}_${idCounter}`;
}

/**
 * Local, on-device store of generated learning cards under
 * `globalStorageUri/learning/library.json` (shared plumbing in
 * {@link JsonLibrary}). Cards are grouped by topic id and shown newest-first.
 */
export class LearningLibrary extends JsonLibrary<LearningCardRecord> {
  constructor(globalStorageUri: vscode.Uri, logger: OutputChannelLogger) {
    super(globalStorageUri, "learning", "cards", logger);
  }

  /** Lower-cased card titles already saved for a topic — used to avoid dupes. */
  async knownTitles(topicId: string): Promise<Set<string>> {
    return new Set(
      (await this.records())
        .filter((c) => c.topicId === topicId)
        .map((c) => c.title.trim().toLowerCase())
    );
  }

  /** All cards for a topic, newest first — the full library (rated and not). */
  async listByTopic(topicId: string): Promise<LearningCardRecord[]> {
    return (await this.records())
      .filter((c) => c.topicId === topicId)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** The review deck: unrated cards for a topic, oldest first. */
  async deckByTopic(topicId: string): Promise<LearningCardRecord[]> {
    return (await this.records())
      .filter((c) => c.topicId === topicId && !c.rating)
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }

  /** Titles the learner marked "didn't know" — the weak spots to focus on. */
  async weakTitles(topicId: string): Promise<string[]> {
    return (await this.records())
      .filter((c) => c.topicId === topicId && c.rating === "unknown")
      .map((c) => c.title);
  }

  /** Set a card's rating (marks it reviewed so it leaves the deck). */
  rate(id: string, rating: LearningRating): Promise<LearningCardRecord | undefined> {
    return this.enqueue(async () => {
      const cards = await this.records();
      const record = cards.find((c) => c.id === id);
      if (!record) {
        return undefined;
      }
      record.rating = rating;
      record.ratedAt = new Date().toISOString();
      await this.persist(cards);
      return record;
    });
  }

  addCard(
    meta: Omit<LearningCardRecord, "id" | "savedAt">
  ): Promise<LearningCardRecord | undefined> {
    return this.enqueue(async () => {
      const cards = await this.records();
      const title = meta.title.trim().toLowerCase();
      if (
        cards.some((c) => c.topicId === meta.topicId && c.title.trim().toLowerCase() === title)
      ) {
        return undefined; // already saved for this topic
      }
      const record: LearningCardRecord = {
        ...meta,
        id: newCardId(),
        savedAt: new Date().toISOString(),
      };
      cards.push(record);
      await this.persist(cards);
      return record;
    });
  }

  /** Remove every saved card for a topic, leaving other topics intact. */
  clearTopic(topicId: string): Promise<void> {
    return this.enqueue(async () => {
      const cards = await this.records();
      await this.persist(cards.filter((c) => c.topicId !== topicId));
    });
  }
}
