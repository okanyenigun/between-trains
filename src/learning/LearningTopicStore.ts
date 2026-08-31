import * as vscode from "vscode";

export type LearningLevel = "beginner" | "intermediate" | "advanced";

export const LEARNING_LEVELS: LearningLevel[] = ["beginner", "intermediate", "advanced"];

/** A user-defined learning track: a tech topic studied at a chosen level. */
export interface LearningTopic {
  id: string;
  title: string;
  level: LearningLevel;
  createdAt: string;
}

const KEY = "betweenTrains.learning.topics";

function isLevel(value: unknown): value is LearningLevel {
  return value === "beginner" || value === "intermediate" || value === "advanced";
}

/**
 * Durable store of the user's learning topics in the global {@link vscode.Memento}.
 * Each topic becomes a dynamic sub-mode under the Learning group. Emits a change
 * event so the controller can re-sync the registered modes and the nav.
 */
export class LearningTopicStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly memento: vscode.Memento) {}

  list(): LearningTopic[] {
    const raw = this.memento.get<LearningTopic[]>(KEY, []);
    return Array.isArray(raw)
      ? raw.filter((t) => t && typeof t.id === "string" && typeof t.title === "string" && isLevel(t.level))
      : [];
  }

  get(id: string): LearningTopic | undefined {
    return this.list().find((t) => t.id === id);
  }

  async add(title: string, level: LearningLevel): Promise<LearningTopic> {
    const topic: LearningTopic = {
      id: `t_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      title: title.trim().slice(0, 60),
      level,
      createdAt: new Date().toISOString(),
    };
    await this.memento.update(KEY, [...this.list(), topic]);
    this._onDidChange.fire();
    return topic;
  }

  async remove(id: string): Promise<void> {
    await this.memento.update(
      KEY,
      this.list().filter((t) => t.id !== id)
    );
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
