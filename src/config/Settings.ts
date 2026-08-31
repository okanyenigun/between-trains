import * as vscode from "vscode";

export const CONFIG_SECTION = "betweenTrains";

/**
 * Configuration facade. All reads of Between Trains settings go through here so
 * that keys and defaults live in one place and are easy to change or test.
 *
 * Defaults mirror the `contributes.configuration` block in package.json.
 */
export class Settings {
  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  get enabled(): boolean {
    return this.config.get<boolean>("enabled", true);
  }

  get autoOpenEnabled(): boolean {
    return this.config.get<boolean>("autoOpen.enabled", false);
  }

  get defaultMode(): string {
    return this.config.get<string>("defaultMode", "lastUsed");
  }

  get ollamaBaseUrl(): string {
    return this.config.get<string>("ollama.baseUrl", "http://localhost:11434");
  }

  get ollamaModel(): string {
    return this.config.get<string>("ollama.model", "llama3.2");
  }

  get ollamaTimeoutMs(): number {
    return this.config.get<number>("ollama.timeoutMs", 30000);
  }

  get brainEnabled(): boolean {
    return this.config.get<boolean>("brain.enabled", true);
  }

  get brainProvider(): string {
    return this.config.get<string>("brain.provider", "ollama");
  }

  get brainWorkspaceContextEnabled(): boolean {
    return this.config.get<boolean>("brain.workspaceContext.enabled", false);
  }

  /** Persist the provider globally so it is remembered across all workspaces. */
  async setBrainProvider(value: string): Promise<void> {
    await this.config.update("brain.provider", value, vscode.ConfigurationTarget.Global);
  }

  /** Persist the model globally so it is remembered across all workspaces. */
  async setOllamaModel(value: string): Promise<void> {
    await this.config.update("ollama.model", value, vscode.ConfigurationTarget.Global);
  }

  get memesAutoFetch(): boolean {
    return this.config.get<boolean>("memes.autoFetch", false);
  }

  get memesFetchCount(): number {
    return this.config.get<number>("memes.fetchCount", 20);
  }

  /** Persist the auto-fetch preference globally (set from the meme mode's UI). */
  async setMemesAutoFetch(value: boolean): Promise<void> {
    await this.config.update("memes.autoFetch", value, vscode.ConfigurationTarget.Global);
  }

  get videosAutoFetch(): boolean {
    return this.config.get<boolean>("videos.autoFetch", false);
  }

  get videosFetchCount(): number {
    return this.config.get<number>("videos.fetchCount", 15);
  }

  async setVideosAutoFetch(value: boolean): Promise<void> {
    await this.config.update("videos.autoFetch", value, vscode.ConfigurationTarget.Global);
  }

  get newsProvider(): string {
    return this.config.get<string>("news.provider", "tavily");
  }

  async setNewsProvider(value: string): Promise<void> {
    await this.config.update("news.provider", value, vscode.ConfigurationTarget.Global);
  }

  get newsAutoFetch(): boolean {
    return this.config.get<boolean>("news.autoFetch", false);
  }

  get newsFetchCount(): number {
    return this.config.get<number>("news.fetchCount", 10);
  }

  async setNewsAutoFetch(value: boolean): Promise<void> {
    await this.config.update("news.autoFetch", value, vscode.ConfigurationTarget.Global);
  }

  get learningAutoFetch(): boolean {
    return this.config.get<boolean>("learning.autoFetch", false);
  }

  get learningCardCount(): number {
    return this.config.get<number>("learning.cardCount", 8);
  }

  async setLearningAutoFetch(value: boolean): Promise<void> {
    await this.config.update("learning.autoFetch", value, vscode.ConfigurationTarget.Global);
  }

  /** Minutes an auto-fetch waits after the last fetch for the same case. */
  get autoFetchCooldownMinutes(): number {
    const value = this.config.get<number>("autoFetch.cooldownMinutes", 30);
    return Number.isFinite(value) && value >= 0 ? value : 30;
  }

  get metadataEnabled(): boolean {
    return this.config.get<boolean>("metadata.enabled", true);
  }

  get metadataRetentionDays(): number {
    return this.config.get<number>("metadata.retentionDays", 30);
  }
}
