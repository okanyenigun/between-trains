import { ModeRegistry } from "./ModeRegistry";

/**
 * Decide which mode a new session should open in, given the user's `defaultMode`
 * setting and the last mode they used. Pure and testable — no `vscode`.
 *
 * The `defaultMode` setting values (other than `lastUsed`) are mode-category ids
 * directly, so a preference resolves to the first enabled mode in that category.
 *
 * - `lastUsed` → the last mode (if still registered + enabled), else the default.
 * - a category preference → the first enabled mode in that category, else default.
 */
export function resolveModeId(
  defaultMode: string,
  lastModeId: string | undefined,
  registry: ModeRegistry
): string | undefined {
  if (defaultMode === "lastUsed") {
    if (lastModeId) {
      const last = registry.get(lastModeId);
      if (last?.enabled) {
        return last.id;
      }
    }
    return registry.defaultModeId;
  }

  const match = registry.listEnabled().find((m) => m.category === defaultMode);
  if (match) {
    return match.id;
  }
  return registry.defaultModeId;
}
