import * as assert from "assert";
import {
  StateChange,
  WaitingRoomStateMachine,
} from "../waiting-room/WaitingRoomStateMachine";

suite("WaitingRoomStateMachine", () => {
  test("starts inactive", () => {
    assert.strictEqual(new WaitingRoomStateMachine().state, "inactive");
  });

  test("confirmed activity opens the room directly", () => {
    const m = new WaitingRoomStateMachine();
    assert.strictEqual(m.send("activity_confirmed"), true);
    assert.strictEqual(m.state, "active");
  });

  test("tentative then confirmed: inactive → maybeActive → active", () => {
    const m = new WaitingRoomStateMachine();
    m.send("session_started");
    assert.strictEqual(m.state, "maybeActive");
    m.send("activity_confirmed");
    assert.strictEqual(m.state, "active");
  });

  test("finishing then ended returns to inactive", () => {
    const m = new WaitingRoomStateMachine("active");
    m.send("session_finishing");
    assert.strictEqual(m.state, "finishing");
    m.send("session_ended");
    assert.strictEqual(m.state, "inactive");
  });

  test("re-activation during finishing goes back to active", () => {
    const m = new WaitingRoomStateMachine("finishing");
    m.send("activity_confirmed");
    assert.strictEqual(m.state, "active");
  });

  test("unknown transitions are ignored and reported as no-ops", () => {
    const m = new WaitingRoomStateMachine();
    assert.strictEqual(m.send("session_ended"), false);
    assert.strictEqual(m.state, "inactive");
  });

  test("reset forces inactive and notifies once", () => {
    const m = new WaitingRoomStateMachine("active");
    let count = 0;
    m.onDidChangeState(() => count++);
    m.reset();
    assert.strictEqual(m.state, "inactive");
    assert.strictEqual(count, 1);
    m.reset(); // already inactive → no-op
    assert.strictEqual(count, 1);
  });

  test("notifies listeners on change and honors dispose", () => {
    const m = new WaitingRoomStateMachine();
    const seen: StateChange[] = [];
    const sub = m.onDidChangeState((c) => seen.push(c));
    m.send("activity_confirmed");
    assert.strictEqual(seen.length, 1);
    assert.deepStrictEqual([seen[0].from, seen[0].to], ["inactive", "active"]);
    sub.dispose();
    m.send("session_ended");
    assert.strictEqual(seen.length, 1);
  });
});
