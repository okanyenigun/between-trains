import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { Settings } from "../config/Settings";
import { FetchThrottle } from "../config/FetchThrottle";
import { MetadataService } from "../metadata/MetadataService";
import { ContentFetchService } from "../content/ContentFetchService";
import { GifLibrary, GifRecord } from "./GifLibrary";
import { runMemeCurator } from "../brain/agents/MemeCuratorAgent";

export interface MemeFetchStatus {
  fetching: boolean;
  /** Saves so far in the current run (live progress). */
  savedThisRun: number;
  lastResult?: { saved: number; ok: boolean; via: string; at: string };
}

/**
 * Orchestrates the meme library: runs the curator agent (with deterministic
 * fallback), throttles to one fetch at a time, logs fetch/save events to the
 * persistent store, and emits status changes for the UI.
 */
export class MemeService extends ContentFetchService<MemeFetchStatus> {
  constructor(
    readonly library: GifLibrary,
    private readonly settings: Settings,
    private readonly metadata: MetadataService,
    private readonly logger: OutputChannelLogger,
    private readonly throttle: FetchThrottle
  ) {
    super({ fetching: false, savedThisRun: 0 });
  }

  /**
   * Fetch new gifs until the configured target is saved. No-ops when a fetch
   * is already running. Never throws — failures land in `lastResult.ok`.
   */
  async fetchBatch(trigger: "auto" | "manual"): Promise<void> {
    if (this.status.fetching) {
      return;
    }
    const cooldownMs = this.settings.autoFetchCooldownMinutes * 60_000;
    if (trigger === "auto" && !this.throttle.shouldAutoFetch("memes", cooldownMs)) {
      this.logger.info("Meme auto-fetch skipped — fetched recently (within cooldown)");
      return;
    }
    void this.throttle.markFetched("memes");
    const target = this.settings.memesFetchCount;
    this.abort = new AbortController();
    this.status = { ...this.status, fetching: true, savedThisRun: 0 };
    this.emit();
    this.metadata.record({ type: "gif_fetch_started", trigger, target });
    this.logger.info(`Meme fetch started (${trigger}, target ${target})`);

    let saved = 0;
    let via = "none";
    let ok = false;
    try {
      const result = await runMemeCurator({
        settings: this.settings,
        library: this.library,
        logger: this.logger,
        target,
        signal: this.abort.signal,
        onSaved: (record) => this.onSaved(record),
      });
      saved = result.saved;
      via = result.via;
      ok = saved > 0;
    } catch (error) {
      this.logger.error("Meme fetch failed", error);
    } finally {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: { saved, ok, via, at: new Date().toISOString() },
      };
      this.metadata.record({ type: "gif_fetch_completed", saved, ok, via });
      this.logger.info(`Meme fetch finished: saved ${saved} via ${via}`);
      this.abort = undefined;
      this.emit();
    }
  }

  private onSaved(record: GifRecord): void {
    this.metadata.record({
      type: "gif_saved",
      gifId: record.id,
      source: record.source,
      tags: record.tags,
    });
    this.status = { ...this.status, savedThisRun: this.status.savedThisRun + 1 };
    this.emit();
  }
}
