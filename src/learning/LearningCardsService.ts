import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { Settings } from "../config/Settings";
import { FetchThrottle } from "../config/FetchThrottle";
import { MetadataService } from "../metadata/MetadataService";
import { ContentFetchService } from "../content/ContentFetchService";
import { OllamaClient } from "../brain/OllamaClient";
import { LearningLibrary, LearningCardRecord } from "./LearningLibrary";
import { LearningTopicStore } from "./LearningTopicStore";
import { runLearningCards } from "../brain/agents/LearningCardsAgent";

export interface LearningFetchStatus {
  fetching: boolean;
  savedThisRun: number;
  lastResult?: { saved: number; ok: boolean; at: string; error?: string };
}

/**
 * Generates learning cards for a topic with the local Ollama brain, one run at a
 * time, and emits status changes. There is no offline fallback — when the brain
 * is disabled or unreachable it reports a `no-brain` result so the UI can prompt.
 */
export class LearningCardsService extends ContentFetchService<LearningFetchStatus> {
  constructor(
    readonly library: LearningLibrary,
    private readonly topics: LearningTopicStore,
    private readonly settings: Settings,
    private readonly metadata: MetadataService,
    private readonly ollama: OllamaClient,
    private readonly logger: OutputChannelLogger,
    private readonly throttle: FetchThrottle
  ) {
    super({ fetching: false, savedThisRun: 0 });
  }

  async fetchBatch(trigger: "auto" | "manual", topicId: string): Promise<void> {
    if (this.status.fetching) {
      return;
    }
    const topic = this.topics.get(topicId);
    if (!topic) {
      return;
    }

    const cooldownMs = this.settings.autoFetchCooldownMinutes * 60_000;
    if (trigger === "auto" && !this.throttle.shouldAutoFetch(`learning:${topicId}`, cooldownMs)) {
      this.logger.info(`Learning auto-generate skipped (${topicId}) — generated recently`);
      return;
    }

    if (!this.settings.brainEnabled || !(await this.brainReachable())) {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: { saved: 0, ok: false, at: new Date().toISOString(), error: "no-brain" },
      };
      this.emit();
      return;
    }

    void this.throttle.markFetched(`learning:${topicId}`);
    const target = this.settings.learningCardCount;
    this.abort = new AbortController();
    this.status = { ...this.status, fetching: true, savedThisRun: 0 };
    this.emit();
    this.metadata.record({
      type: "learning_generate_started",
      trigger: `${trigger}:${topicId}`,
      target,
    });
    this.logger.info(`Learning generate started (${trigger}, "${topic.title}" @ ${topic.level}, target ${target})`);

    let saved = 0;
    let ok = false;
    let error: string | undefined;
    try {
      saved = await runLearningCards({
        settings: this.settings,
        library: this.library,
        logger: this.logger,
        topicId,
        topic: topic.title,
        level: topic.level,
        target,
        weakConcepts: await this.library.weakTitles(topicId),
        signal: this.abort.signal,
        onSaved: (record) => this.onSaved(record),
      });
      ok = saved > 0;
      if (!ok) {
        error = "empty";
      }
    } catch (err) {
      this.logger.error("Learning generation failed", err);
      error = "failed";
    } finally {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: { saved, ok, at: new Date().toISOString(), error: ok ? undefined : error },
      };
      this.metadata.record({ type: "learning_generate_completed", saved, ok });
      this.logger.info(`Learning generate finished: saved ${saved}`);
      this.abort = undefined;
      this.emit();
    }
  }

  private async brainReachable(): Promise<boolean> {
    try {
      const status = await this.ollama.status();
      return status.reachable && status.modelAvailable;
    } catch {
      return false;
    }
  }

  private onSaved(record: LearningCardRecord): void {
    this.metadata.record({ type: "learning_card_saved", topicId: record.topicId });
    this.status = { ...this.status, savedThisRun: this.status.savedThisRun + 1 };
    this.emit();
    this.logger.info(`Learning card saved: ${record.title}`);
  }
}
