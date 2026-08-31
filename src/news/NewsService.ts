import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { Settings } from "../config/Settings";
import { FetchThrottle } from "../config/FetchThrottle";
import { MetadataService } from "../metadata/MetadataService";
import { ContentFetchService } from "../content/ContentFetchService";
import { NewsProvider, SecretsStore } from "../config/SecretsStore";
import { NewsLibrary, NewsRecord } from "./NewsLibrary";
import { runNewsCurator } from "../brain/agents/NewsCuratorAgent";

export interface NewsFetchStatus {
  fetching: boolean;
  savedThisRun: number;
  lastResult?: { saved: number; ok: boolean; via: string; at: string; error?: string };
}

/**
 * Orchestrates news fetching: reads the configured provider + its secret key,
 * runs the curator agent (with fallback) one category at a time, logs events,
 * and emits status. Never throws — failures land in `lastResult`.
 */
export class NewsService extends ContentFetchService<NewsFetchStatus> {
  constructor(
    readonly library: NewsLibrary,
    private readonly settings: Settings,
    private readonly secrets: SecretsStore,
    private readonly metadata: MetadataService,
    private readonly logger: OutputChannelLogger,
    private readonly throttle: FetchThrottle,
  ) {
    super({ fetching: false, savedThisRun: 0 });
  }

  /** Currently configured provider name. */
  provider(): NewsProvider {
    const value = this.settings.newsProvider;
    return value === "brave" || value === "serper" ? value : "tavily";
  }

  /** True when the configured provider has an API key stored. */
  hasApiKey(): Promise<boolean> {
    return this.secrets.hasNewsApiKey(this.provider());
  }

  async fetchBatch(trigger: "auto" | "manual", category: string): Promise<void> {
    if (this.status.fetching) {
      return;
    }
    const provider = this.provider();
    const apiKey = await this.secrets.getNewsApiKey(provider);
    if (!apiKey) {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: {
          saved: 0,
          ok: false,
          via: "none",
          at: new Date().toISOString(),
          error: "no-api-key",
        },
      };
      this.emit();
      return;
    }

    const cooldownMs = this.settings.autoFetchCooldownMinutes * 60_000;
    if (trigger === "auto" && !this.throttle.shouldAutoFetch(`news:${category}`, cooldownMs)) {
      this.logger.info(`News auto-fetch skipped (${category}) — fetched recently (within cooldown)`);
      return;
    }
    void this.throttle.markFetched(`news:${category}`);

    const target = this.settings.newsFetchCount;
    this.abort = new AbortController();
    this.status = { ...this.status, fetching: true, savedThisRun: 0 };
    this.emit();
    this.metadata.record({ type: "news_fetch_started", trigger: `${trigger}:${category}`, target });
    this.logger.info(`News fetch started (${trigger}, ${category}, ${provider}, target ${target})`);

    let saved = 0;
    let via = "none";
    let ok = false;
    try {
      const result = await runNewsCurator({
        settings: this.settings,
        provider,
        apiKey,
        library: this.library,
        logger: this.logger,
        category,
        target,
        signal: this.abort.signal,
        onSaved: (record) => this.onSaved(record),
      });
      saved = result.saved;
      via = result.via;
      ok = saved > 0;
    } catch (error) {
      this.logger.error("News fetch failed", error);
    } finally {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: { saved, ok, via, at: new Date().toISOString() },
      };
      this.metadata.record({ type: "news_fetch_completed", saved, ok, via });
      this.logger.info(`News fetch finished: saved ${saved} via ${via}`);
      this.abort = undefined;
      this.emit();
    }
  }

  private onSaved(record: NewsRecord): void {
    this.metadata.record({
      type: "news_saved",
      category: record.category,
      source: record.source,
    });
    this.status = { ...this.status, savedThisRun: this.status.savedThisRun + 1 };
    this.emit();
  }
}
