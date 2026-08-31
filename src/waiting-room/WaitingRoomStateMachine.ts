/**
 * Pure, framework-free state machine for the waiting-room lifecycle.
 *
 * It has no dependency on the `vscode` API so it can be reasoned about and unit
 * tested in isolation. All UI side effects live in the WaitingRoomController.
 *
 * States (product brief §9 / §27.3.1):
 *
 *   inactive → maybeActive → active → finishing → inactive
 *                               ↑___________________|  (re-activation)
 */
export type WaitingRoomState = "inactive" | "maybeActive" | "active" | "finishing";

export type WaitingRoomEvent =
  | "session_started"
  | "activity_confirmed"
  | "session_finishing"
  | "session_ended"
  | "user_closed_panel"
  | "developer_returned"
  | "error";

export interface StateChange {
  from: WaitingRoomState;
  to: WaitingRoomState;
  event: WaitingRoomEvent;
  at: number;
}

export type StateChangeListener = (change: StateChange) => void;

/** Explicit transition table. Anything not listed is a no-op in that state. */
const TRANSITIONS: Record<
  WaitingRoomState,
  Partial<Record<WaitingRoomEvent, WaitingRoomState>>
> = {
  inactive: {
    session_started: "maybeActive",
    activity_confirmed: "active",
  },
  maybeActive: {
    activity_confirmed: "active",
    session_ended: "inactive",
    developer_returned: "inactive",
    user_closed_panel: "inactive",
    error: "inactive",
  },
  active: {
    session_finishing: "finishing",
    session_ended: "inactive",
    user_closed_panel: "inactive",
    developer_returned: "inactive",
    error: "inactive",
  },
  finishing: {
    activity_confirmed: "active",
    session_started: "active",
    session_ended: "inactive",
    user_closed_panel: "inactive",
    developer_returned: "inactive",
    error: "inactive",
  },
};

export class WaitingRoomStateMachine {
  private _state: WaitingRoomState;
  private readonly listeners = new Set<StateChangeListener>();

  constructor(initial: WaitingRoomState = "inactive") {
    this._state = initial;
  }

  get state(): WaitingRoomState {
    return this._state;
  }

  get isActive(): boolean {
    return this._state === "active";
  }

  /**
   * Applies an event. Returns `true` if it caused a state change. Unknown or
   * self transitions are ignored and do not notify listeners.
   */
  send(event: WaitingRoomEvent): boolean {
    const next = TRANSITIONS[this._state][event];
    if (next === undefined || next === this._state) {
      return false;
    }
    this.transitionTo(next, event);
    return true;
  }

  /** Force the machine back to `inactive`, notifying listeners if it changed. */
  reset(): void {
    if (this._state === "inactive") {
      return;
    }
    this.transitionTo("inactive", "session_ended");
  }

  onDidChangeState(listener: StateChangeListener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private transitionTo(next: WaitingRoomState, event: WaitingRoomEvent): void {
    const change: StateChange = { from: this._state, to: next, event, at: Date.now() };
    this._state = next;
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}
