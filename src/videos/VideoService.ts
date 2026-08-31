import { OutputChannelLogger } from "../logging/OutputChannelLogger";
import { Settings } from "../config/Settings";
import { FetchThrottle } from "../config/FetchThrottle";
import { MetadataService } from "../metadata/MetadataService";
import { ContentFetchService } from "../content/ContentFetchService";
import { VideoKind, VideoLibrary, VideoRecord } from "./VideoLibrary";
import { runVideoCurator } from "../brain/agents/VideoCuratorAgent";

export interface VideoFetchStatus {
  fetching: boolean;
  savedThisRun: number;
  lastResult?: { saved: number; ok: boolean; via: string; at: string };
}

/**
 * Orchestrates the video library: runs the curator agent (with deterministic
 * fallback), one fetch at a time, logs fetch/save events, and emits status.
 */
export class VideoService extends ContentFetchService<VideoFetchStatus> {
  constructor(
    readonly library: VideoLibrary,
    private readonly settings: Settings,
    private readonly metadata: MetadataService,
    private readonly logger: OutputChannelLogger,
    private readonly throttle: FetchThrottle
  ) {
    super({ fetching: false, savedThisRun: 0 });
  }

  async fetchBatch(trigger: "auto" | "manual", kind: VideoKind): Promise<void> {
    if (this.status.fetching) {
      return;
    }
    const cooldownMs = this.settings.autoFetchCooldownMinutes * 60_000;
    if (trigger === "auto" && !this.throttle.shouldAutoFetch(`videos:${kind}`, cooldownMs)) {
      this.logger.info(`Video auto-fetch skipped (${kind}) — fetched recently (within cooldown)`);
      return;
    }
    void this.throttle.markFetched(`videos:${kind}`);
    const target = this.settings.videosFetchCount;
    this.abort = new AbortController();
    this.status = { ...this.status, fetching: true, savedThisRun: 0 };
    this.emit();
    this.metadata.record({ type: "video_fetch_started", trigger: `${trigger}:${kind}`, target });
    this.logger.info(`Video fetch started (${trigger}, ${kind}, target ${target})`);

    let saved = 0;
    let via = "none";
    let ok = false;
    try {
      const result = await runVideoCurator({
        settings: this.settings,
        library: this.library,
        logger: this.logger,
        kind,
        target,
        signal: this.abort.signal,
        onSaved: (record) => this.onSaved(record),
      });
      saved = result.saved;
      via = result.via;
      ok = saved > 0;
    } catch (error) {
      this.logger.error("Video fetch failed", error);
    } finally {
      this.status = {
        fetching: false,
        savedThisRun: 0,
        lastResult: { saved, ok, via, at: new Date().toISOString() },
      };
      this.metadata.record({ type: "video_fetch_completed", saved, ok, via });
      this.logger.info(`Video fetch finished: saved ${saved} via ${via}`);
      this.abort = undefined;
      this.emit();
    }
  }

  private onSaved(record: VideoRecord): void {
    this.metadata.record({
      type: "video_saved",
      videoId: record.videoId,
      channel: record.channel,
      tags: record.tags,
    });
    this.status = { ...this.status, savedThisRun: this.status.savedThisRun + 1 };
    this.emit();
  }
}
