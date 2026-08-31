import * as vscode from "vscode";

/** The status fields every content-fetch service exposes. */
export interface FetchStatusBase {
  fetching: boolean;
  savedThisRun: number;
}

/**
 * Shared plumbing for the content-fetch services (memes, videos, news,
 * learning): a single-flight status object, an abort handle for the in-flight
 * run, and a change event the UI subscribes to. Subclasses own `fetchBatch` —
 * the orchestration (arguments, pre-checks, event names) differs per vertical —
 * and drive UI refreshes by mutating {@link status} and calling {@link emit}.
 */
export abstract class ContentFetchService<TStatus extends FetchStatusBase>
  implements vscode.Disposable
{
  private readonly _onDidChangeStatus = new vscode.EventEmitter<TStatus>();
  /** Fired whenever fetch progress/state changes (drive UI refreshes from this). */
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  protected status: TStatus;
  protected abort: AbortController | undefined;

  protected constructor(initialStatus: TStatus) {
    this.status = initialStatus;
  }

  getStatus(): TStatus {
    return { ...this.status };
  }

  /** Abort the in-flight fetch, if any. */
  cancel(): void {
    this.abort?.abort();
  }

  dispose(): void {
    this.cancel();
    this._onDidChangeStatus.dispose();
  }

  protected emit(): void {
    this._onDidChangeStatus.fire(this.getStatus());
  }
}
