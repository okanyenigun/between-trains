import * as vscode from "vscode";
import { Commands } from "../commands";

/**
 * Compact, always-available control surface (product brief §10.2 / §27.4.1).
 * Reflects the current waiting-room state and, when clicked, opens or reveals
 * the waiting room. Kept small and calm — a single item that never competes for
 * attention.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = Commands.openWaitingRoom;
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text = "🚉 Between Trains";
    this.item.tooltip = "Between Trains — click to start a waiting session.";
  }

  setWaiting(label = "Waiting room"): void {
    this.item.text = "🚉 Waiting";
    this.item.tooltip = `Between Trains — ${label} in progress. Click to reveal.`;
  }

  setFinishing(): void {
    this.item.text = "🚉 Wrapping up";
    this.item.tooltip = "Between Trains — session finishing.";
  }

  setDisabled(): void {
    this.item.text = "🚉 Off";
    this.item.tooltip = "Between Trains is disabled.";
  }

  dispose(): void {
    this.item.dispose();
  }
}
