import { WaitingModeDescriptor } from "./types";

/**
 * Registry of all waiting-room modes. Framework-free (no `vscode`) so it can be
 * unit tested directly. Adding a mode means registering a descriptor — the
 * controller and panel manager do not change (product brief §27.5.1).
 */
export class ModeRegistry {
  private readonly modes = new Map<string, WaitingModeDescriptor>();

  register(mode: WaitingModeDescriptor): void {
    if (this.modes.has(mode.id)) {
      throw new Error(`Mode already registered: ${mode.id}`);
    }
    this.modes.set(mode.id, mode);
  }

  /** Remove a mode. Used for dynamic modes (e.g. user-defined learning topics). */
  unregister(id: string): void {
    this.modes.delete(id);
  }

  get(id: string): WaitingModeDescriptor | undefined {
    return this.modes.get(id);
  }

  has(id: string): boolean {
    return this.modes.has(id);
  }

  /** All modes, in registration order. */
  list(): WaitingModeDescriptor[] {
    return [...this.modes.values()];
  }

  listEnabled(): WaitingModeDescriptor[] {
    return this.list().filter((m) => m.enabled);
  }

  /** Id of the first enabled mode; the ultimate fallback for resolution. */
  get defaultModeId(): string | undefined {
    return this.listEnabled()[0]?.id;
  }
}
