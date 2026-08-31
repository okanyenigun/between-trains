import * as vscode from "vscode";
import { LearningCardsService } from "../../learning/LearningCardsService";
import {
  LearningTopicStore,
  LEARNING_LEVELS,
  LearningLevel,
} from "../../learning/LearningTopicStore";
import { LearningCardView } from "../../webview/protocol";
import {
  LEARNING_MANAGE_ID,
  LEARNING_TOPIC_PREFIX,
  isLearningTopicId,
  learningTopicIdOf,
  levelLabel,
} from "../modeIds";
import { ModePresenterContext } from "./context";

/**
 * Owns the learning modes: the topic-management view and, per user-defined
 * topic, generating and reviewing cards. Card content is produced by the local
 * model (there is no offline fallback); the service reports when it's absent.
 */
export class LearningPresenter {
  private index = 0;

  constructor(
    private readonly ctx: ModePresenterContext,
    private readonly learning: LearningCardsService,
    private readonly topics: LearningTopicStore
  ) {}

  /** The topic id of the current mode, or undefined if not on a topic mode. */
  topicId(): string | undefined {
    const id = this.ctx.currentModeId();
    return id && isLearningTopicId(id) ? learningTopicIdOf(id) : undefined;
  }

  /** Re-push the current topic after a status change (no shown logging). */
  async refreshCurrent(): Promise<void> {
    const id = this.topicId();
    if (id) {
      await this.pushState(id, false, false);
    }
  }

  async open(topicId: string): Promise<void> {
    this.index = 0;
    await this.pushState(topicId, true, true);
    if (this.ctx.settings.learningAutoFetch && !this.learning.getStatus().fetching) {
      // Empty deck → generate now (nothing to review); otherwise top up,
      // respecting the auto-fetch cooldown.
      const deck = await this.learning.library.deckByTopic(topicId);
      void this.learning.fetchBatch(deck.length === 0 ? "manual" : "auto", topicId);
    }
  }

  /** When auto-generate is on and the review deck is empty, pull more cards
   *  now (bypassing the cooldown — finishing the deck is a real signal). */
  private async autoGenerateIfDeckEmpty(topicId: string): Promise<void> {
    if (!this.ctx.settings.learningAutoFetch || this.learning.getStatus().fetching) {
      return;
    }
    const deck = await this.learning.library.deckByTopic(topicId);
    if (deck.length === 0) {
      void this.learning.fetchBatch("manual", topicId);
    }
  }

  async step(delta: number): Promise<void> {
    this.index += delta;
    const id = this.topicId();
    if (id) {
      await this.pushState(id, false, true);
    }
  }

  async generate(): Promise<void> {
    const id = this.topicId();
    if (id) {
      await this.learning.fetchBatch("manual", id);
    }
  }

  /** Rate the current card ("knew it" / "didn't know") — it leaves the deck and
   *  the rating feeds the next generation's focus. */
  async rate(id: string, known: boolean): Promise<void> {
    const topicId = this.topicId();
    if (!topicId) {
      return;
    }
    await this.learning.library.rate(id, known ? "known" : "unknown");
    this.ctx.metadata.record({
      type: "learning_card_rated",
      sessionId: this.ctx.currentSessionId(),
      cardId: id,
      known,
    });
    this.ctx.logger.info(`Learning card rated ${known ? "known" : "unknown"}: ${id}`);
    await this.pushState(topicId, false, true);
    await this.autoGenerateIfDeckEmpty(topicId);
  }

  async setAutoFetch(value: boolean): Promise<void> {
    await this.ctx.settings.setLearningAutoFetch(value);
    const id = this.topicId();
    if (id) {
      await this.pushState(id, false, false);
      if (value) {
        await this.autoGenerateIfDeckEmpty(id);
      }
    }
  }

  /** Send the list of topics + levels to the manage view. */
  pushTopics(): void {
    if (!this.ctx.panel.isOpen) {
      return;
    }
    this.ctx.panel.sendLearningTopics({
      topics: this.topics.list().map((t) => ({ id: t.id, title: t.title, level: t.level })),
      levels: LEARNING_LEVELS.map((l) => ({ id: l, label: levelLabel(l) })),
    });
  }

  /** Send the current topic's card + browse position; card at `index`. */
  async pushState(topicId: string, resetIndex: boolean, logShown: boolean): Promise<void> {
    if (!this.ctx.panel.isOpen || this.topicId() !== topicId) {
      return;
    }
    const topic = this.topics.get(topicId);
    if (!topic) {
      return;
    }
    const deck = await this.learning.library.deckByTopic(topicId);
    const all = await this.learning.library.listByTopic(topicId);
    if (resetIndex) {
      this.index = 0;
    }
    const total = deck.length;
    this.index = total === 0 ? 0 : Math.max(0, Math.min(this.index, total - 1));
    const record = deck[this.index];
    if (record && logShown) {
      this.ctx.metadata.record({
        type: "learning_card_shown",
        sessionId: this.ctx.currentSessionId(),
        cardId: record.id,
        topicId,
      });
    }
    const status = this.learning.getStatus();
    const toView = (c: {
      id: string;
      title: string;
      body: string;
      example?: string;
      rating?: "known" | "unknown";
    }): LearningCardView => ({
      id: c.id,
      title: c.title,
      body: c.body,
      example: c.example,
      level: topic.level,
      rating: c.rating,
    });
    this.ctx.panel.sendLearningState({
      topicId,
      topicTitle: topic.title,
      level: topic.level,
      card: record ? toView(record) : null,
      libraryList: all.map(toView),
      index: this.index,
      total,
      generating: status.fetching,
      savedThisRun: status.savedThisRun,
      autoFetch: this.ctx.settings.learningAutoFetch,
      hasBrain: this.ctx.settings.brainEnabled,
      lastResult: status.lastResult,
    });
  }

  async clearLibrary(): Promise<void> {
    const id = this.topicId();
    const topic = id ? this.topics.get(id) : undefined;
    if (!id || !topic) {
      return;
    }
    if (!(await this.ctx.confirmClear(`all saved "${topic.title}" cards`))) {
      return;
    }
    this.learning.cancel();
    await this.learning.library.clearTopic(id);
    this.index = 0;
    this.ctx.logger.info(`Learning library cleared (${topic.title})`);
    await this.pushState(id, true, false);
  }

  async addTopic(): Promise<void> {
    const title = await vscode.window.showInputBox({
      title: "New learning topic",
      prompt: "A tech topic to study — e.g. 'React hooks', 'PostgreSQL indexing', 'Rust ownership'",
      ignoreFocusOut: true,
    });
    if (title === undefined || !title.trim()) {
      return;
    }
    const levelPick = await vscode.window.showQuickPick(
      LEARNING_LEVELS.map((l) => ({ label: levelLabel(l), value: l as LearningLevel })),
      { title: `Level for "${title.trim()}"`, placeHolder: "How deep should the cards go?" }
    );
    if (!levelPick) {
      return;
    }
    const topic = await this.topics.add(title, levelPick.value);
    this.ctx.logger.info(`Learning topic added: ${topic.title} (${topic.level})`);
    // topics.onDidChange already re-registered the mode; open it.
    this.ctx.setMode(LEARNING_TOPIC_PREFIX + topic.id);
  }

  async removeTopic(id: string): Promise<void> {
    const topic = this.topics.get(id);
    if (!topic) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Remove the topic "${topic.title}" and its saved cards? This cannot be undone.`,
      { modal: true },
      "Remove"
    );
    if (choice !== "Remove") {
      return;
    }
    const wasCurrent = this.topicId() === id;
    await this.learning.library.clearTopic(id);
    await this.topics.remove(id);
    this.ctx.logger.info(`Learning topic removed: ${topic.title}`);
    if (wasCurrent) {
      this.ctx.setMode(LEARNING_MANAGE_ID);
    } else {
      this.pushTopics();
    }
  }
}
