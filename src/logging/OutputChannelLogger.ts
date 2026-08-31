import * as vscode from "vscode";

/**
 * Thin wrapper around a VS Code {@link vscode.LogOutputChannel}.
 *
 * This is the single logging surface for the extension. It must never be used
 * to log secrets, API keys, prompts, or raw workspace/source content.
 */
export class OutputChannelLogger {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name = "Between Trains") {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  info(message: string, ...args: unknown[]): void {
    this.channel.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.channel.warn(message, ...args);
  }

  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      this.channel.error(`${message}: ${error.message}`);
    } else if (error !== undefined) {
      this.channel.error(`${message}: ${String(error)}`);
    } else {
      this.channel.error(message);
    }
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
