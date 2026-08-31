import * as vscode from "vscode";

/**
 * Remembers when each auto-fetching case last actually fetched, so opening a
 * tab with auto-fetch on doesn't re-fetch content that was just pulled.
 *
 * A "case" is a specific content stream — `"memes"`, `"videos:programming"`,
 * `"news:world"`, … — tracked independently. Timestamps are persisted in the
 * global {@link vscode.Memento}, so the cooldown survives closing/reopening the
 * panel and reloading the window. Manual fetches record a timestamp too (so a
 * manual pull also resets the auto cooldown), but they are never blocked.
 */
export class FetchThrottle {
  constructor(private readonly memento: vscode.Memento) {}

  private key(caseId: string): string {
    return `betweenTrains.lastFetch.${caseId}`;
  }

  /** Epoch millis of the last recorded fetch for this case, if any. */
  lastFetchAt(caseId: string): number | undefined {
    const value = this.memento.get<number>(this.key(caseId));
    return typeof value === "number" ? value : undefined;
  }

  /** True when no fetch has happened for this case within `cooldownMs`. */
  shouldAutoFetch(caseId: string, cooldownMs: number): boolean {
    if (cooldownMs <= 0) {
      return true;
    }
    const last = this.lastFetchAt(caseId);
    return last === undefined || Date.now() - last >= cooldownMs;
  }

  /** Record that a fetch just happened for this case. */
  markFetched(caseId: string): Thenable<void> {
    return this.memento.update(this.key(caseId), Date.now());
  }
}
