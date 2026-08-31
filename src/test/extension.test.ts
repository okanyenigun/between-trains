import * as assert from "assert";
import * as vscode from "vscode";

suite("Between Trains", () => {
  test("commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("betweenTrains.startManualSession"),
      "expected startManualSession command to be registered"
    );
  });
});
