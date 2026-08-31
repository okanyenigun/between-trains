import * as vscode from "vscode";
import { VideoService } from "../../videos/VideoService";
import { VideoKind } from "../../videos/VideoLibrary";
import { VideoView } from "../../webview/protocol";
import { VIDEO_RANDOM_ID, isVideoModeId } from "../modeIds";
import { ModePresenterContext } from "./context";

/** Owns the two video sub-modes (Random / Programming): deck, rating, playback. */
export class VideoPresenter {
  /** The video currently on the deck (kept so status refreshes don't reload it). */
  private currentVideo: VideoView | null = null;

  constructor(
    private readonly ctx: ModePresenterContext,
    private readonly videos: VideoService
  ) {}

  /** Which video sub-mode is active (Random vs Programming). */
  kind(): VideoKind {
    return this.ctx.currentModeId() === VIDEO_RANDOM_ID ? "random" : "programming";
  }

  async open(): Promise<void> {
    this.currentVideo = null; // switching sub-modes starts a fresh deck
    await this.pushState(true);
    if (this.ctx.settings.videosAutoFetch && !this.videos.getStatus().fetching) {
      void this.videos.fetchBatch("auto", this.kind());
    }
  }

  /**
   * Push the video mode state. `advance` consumes the next unseen video (marking
   * it shown so it is never shown again); otherwise the current video is kept.
   */
  async pushState(advance: boolean): Promise<void> {
    if (!this.ctx.panel.isOpen || !isVideoModeId(this.ctx.currentModeId())) {
      return;
    }
    const library = this.videos.library;
    const kind = this.kind();

    if (advance) {
      const record = await library.takeNextUnseen(kind);
      this.currentVideo = record
        ? { id: record.id, videoId: record.videoId, title: record.title, channel: record.channel }
        : null;
      if (record) {
        this.ctx.metadata.record({
          type: "video_shown",
          sessionId: this.ctx.currentSessionId(),
          videoId: record.videoId,
        });
      }
    }

    const toVideoView = (v: {
      id: string;
      videoId: string;
      title: string;
      channel: string;
    }): VideoView => ({ id: v.id, videoId: v.videoId, title: v.title, channel: v.channel });
    const likedRecords = await library.likedList(kind);
    const libraryRecords = await library.listByKind(kind);
    const counts = await library.counts(kind);
    const status = this.videos.getStatus();
    this.ctx.panel.sendVideoState({
      current: this.currentVideo,
      liked: likedRecords.map(toVideoView),
      library: libraryRecords.map(toVideoView),
      total: counts.total,
      unseen: counts.unseen,
      likedCount: counts.liked,
      fetching: status.fetching,
      savedThisRun: status.savedThisRun,
      autoFetch: this.ctx.settings.videosAutoFetch,
      fetchCount: this.ctx.settings.videosFetchCount,
      lastFetch: status.lastResult
        ? { saved: status.lastResult.saved, ok: status.lastResult.ok, at: status.lastResult.at }
        : undefined,
    });
  }

  fetchNow(): void {
    void this.videos.fetchBatch("manual", this.kind());
  }

  async rate(id: string, liked: boolean): Promise<void> {
    const record = await this.videos.library.rate(id, liked);
    this.ctx.metadata.record({
      type: "video_rated",
      sessionId: this.ctx.currentSessionId(),
      videoId: record?.videoId ?? id,
      liked,
    });
    this.ctx.logger.info(`Video ${liked ? "liked" : "disliked"}: ${id}`);
    await this.pushState(true);
  }

  async replay(id: string): Promise<void> {
    const liked = await this.videos.library.likedList(this.kind());
    const match = liked.find((v) => v.id === id);
    this.ctx.metadata.record({
      type: "video_replayed",
      sessionId: this.ctx.currentSessionId(),
      videoId: match?.videoId ?? id,
    });
  }

  /** Open a video on youtube.com in the external browser (embed fallback). */
  openExternal(videoId: string): void {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return;
    }
    void vscode.env.openExternal(vscode.Uri.parse(`https://www.youtube.com/watch?v=${videoId}`));
  }

  async setAutoFetch(value: boolean): Promise<void> {
    await this.ctx.settings.setVideosAutoFetch(value);
    this.ctx.logger.info(`Video auto-fetch set to ${value}`);
    await this.pushState(false);
  }

  async clearLibrary(): Promise<void> {
    const kind = this.kind();
    if (!(await this.ctx.confirmClear(`all saved ${kind} videos`))) {
      return;
    }
    this.videos.cancel();
    await this.videos.library.clearKind(kind);
    this.currentVideo = null;
    this.ctx.logger.info(`Video library cleared (${kind})`);
    await this.pushState(true);
  }
}
