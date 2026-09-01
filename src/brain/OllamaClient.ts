import * as vscode from "vscode";
import { Settings } from "../config/Settings";

export interface OllamaStatus {
  reachable: boolean;
  baseUrl: string;
  model: string;
  models: string[];
  modelAvailable: boolean;
  error?: string;
}

/**
 * Minimal probe for a local Ollama server: reports whether it is reachable and
 * whether the configured model is installed. Never throws for an unreachable
 * server — callers fall back to offline content (product brief §12). All actual
 * generation goes through the LangChain agents, not this client.
 */
export class OllamaClient {
  constructor(private readonly settings: Settings) {}

  /** Rich status for the connection-test command. */
  async status(token?: vscode.CancellationToken): Promise<OllamaStatus> {
    const baseUrl = this.settings.ollamaBaseUrl;
    const model = this.settings.ollamaModel;
    try {
      const res = await this.fetch("/api/tags", { method: "GET" }, token);
      if (!res.ok) {
        return { reachable: false, baseUrl, model, models: [], modelAvailable: false, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { models?: { name?: string }[] };
      const models = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      // A blank model means "auto-select an installed one", so any model counts.
      const modelAvailable = model
        ? models.some((m) => m === model || m.startsWith(`${model}:`))
        : models.length > 0;
      return { reachable: true, baseUrl, model, models, modelAvailable };
    } catch (error) {
      return {
        reachable: false,
        baseUrl,
        model,
        models: [],
        modelAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async fetch(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    token?: vscode.CancellationToken
  ): Promise<Response> {
    const url = this.settings.ollamaBaseUrl.replace(/\/$/, "") + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.ollamaTimeoutMs);
    const sub = token?.onCancellationRequested(() => controller.abort());
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      sub?.dispose();
    }
  }
}
