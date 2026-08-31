import * as vscode from "vscode";

export type NewsProvider = "tavily" | "brave" | "serper";

/**
 * Thin wrapper over VS Code {@link vscode.SecretStorage} for the news web-search
 * API keys. Secrets live only here (never settings.json, globalState, or logs),
 * per the storage convention. Keys are never returned to the webview — only a
 * "set / not set" flag is surfaced.
 */
export class SecretsStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  private key(provider: NewsProvider): string {
    return `betweenTrains.news.apiKey.${provider}`;
  }

  getNewsApiKey(provider: NewsProvider): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(this.key(provider)));
  }

  async hasNewsApiKey(provider: NewsProvider): Promise<boolean> {
    const value = await this.secrets.get(this.key(provider));
    return typeof value === "string" && value.length > 0;
  }

  setNewsApiKey(provider: NewsProvider, value: string): Promise<void> {
    return Promise.resolve(this.secrets.store(this.key(provider), value));
  }

  clearNewsApiKey(provider: NewsProvider): Promise<void> {
    return Promise.resolve(this.secrets.delete(this.key(provider)));
  }
}
