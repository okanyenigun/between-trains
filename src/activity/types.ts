import * as vscode from "vscode";

/**
 * Coarse lifecycle phase reported by a signal provider. Providers contribute
 * *evidence* that an agent is (or is not) working; the controller decides what
 * to do with it. See product brief §8.
 */
export type AgentActivityPhase =
  | "inactive"
  | "maybe-active"
  | "active"
  | "waiting-for-user"
  | "completed"
  | "failed";

export interface AgentActivityEvent {
  /** Id of the provider that produced this event. */
  providerId: string;
  phase: AgentActivityPhase;
  /** 0.0 – 1.0. Trusted providers (e.g. manual) report 1.0. */
  confidence: number;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A pluggable source of agent-activity evidence. `start`/`stop` control the
 * provider's own lifecycle (attach/detach listeners); actual activity is
 * reported through `onActivityChanged`.
 */
export interface AgentSignalProvider extends vscode.Disposable {
  readonly id: string;
  readonly label: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  readonly onActivityChanged: vscode.Event<AgentActivityEvent>;
}
