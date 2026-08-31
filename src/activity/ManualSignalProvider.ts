import * as vscode from "vscode";
import { AgentActivityEvent, AgentSignalProvider } from "./types";

/**
 * The most reliable signal provider: the user explicitly starts and stops the
 * waiting room. Between Trains fully owns this lifecycle, so every event is
 * reported with full confidence (1.0). See product brief §8.4.1.
 */
export class ManualSignalProvider implements AgentSignalProvider {
  readonly id = "manual";
  readonly label = "Manual";

  private readonly emitter = new vscode.EventEmitter<AgentActivityEvent>();
  readonly onActivityChanged = this.emitter.event;
  private active = false;

  /** Manual sessions are driven by commands, so there is nothing to attach. */
  start(): void {
    // no-op
  }

  stop(): void {
    this.endSession("provider_stopped");
  }

  beginSession(label = "Manual session"): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.emitter.fire({
      providerId: this.id,
      phase: "active",
      confidence: 1,
      startedAt: Date.now(),
      label,
    });
  }

  endSession(reason = "manual"): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.emitter.fire({
      providerId: this.id,
      phase: "inactive",
      confidence: 1,
      endedAt: Date.now(),
      metadata: { reason },
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
