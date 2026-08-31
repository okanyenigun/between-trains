import * as vscode from "vscode";

const LAST_MODE_KEY = "betweenTrains.lastModeId";

/**
 * Small wrapper over a global {@link vscode.Memento} for durable,
 * cross-workspace user preferences (product brief §14.3). The broader metadata
 * service (M5) will build on this; for now it just remembers the last-used mode.
 */
export class PreferenceStore {
  constructor(private readonly memento: vscode.Memento) {}

  getLastModeId(): string | undefined {
    return this.memento.get<string>(LAST_MODE_KEY);
  }

  async setLastModeId(id: string): Promise<void> {
    await this.memento.update(LAST_MODE_KEY, id);
  }

  async clearLastModeId(): Promise<void> {
    await this.memento.update(LAST_MODE_KEY, undefined);
  }
}
