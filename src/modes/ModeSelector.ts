import * as vscode from "vscode";
import { ModeRegistry } from "./ModeRegistry";
import { ModeCategory } from "./types";

/**
 * Product-facing group name per category, shown in the Quick Pick. Kept in sync
 * with `GROUP_LABELS` in media/waiting-room.js so the command-palette picker and
 * the in-panel nav use identical wording.
 */
const CATEGORY_LABEL: Record<ModeCategory, string> = {
  microgame: "Micro-Games",
  ambient: "Ambient Zen",
  learning: "Learning Cards",
  physical: "Physical Break",
  media: "Media",
  news: "News",
};

interface ModeQuickPickItem extends vscode.QuickPickItem {
  id: string;
}

/**
 * Show a Quick Pick of enabled modes; resolves to the chosen mode id, or
 * `undefined` if the user dismissed it.
 */
export async function pickMode(
  registry: ModeRegistry,
  currentId: string | undefined
): Promise<string | undefined> {
  const items: ModeQuickPickItem[] = registry.listEnabled().map((mode) => ({
    id: mode.id,
    label: mode.title,
    description: CATEGORY_LABEL[mode.category] + (mode.id === currentId ? " · current" : ""),
    detail: mode.description + (mode.requiresBrain ? "  (needs Ollama)" : ""),
  }));

  const choice = await vscode.window.showQuickPick(items, {
    title: "Between Trains — Select Mode",
    placeHolder: "Choose a waiting-room mode",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return choice?.id;
}
