import * as assert from "assert";
import {
  INTERACTION_SCHEMA_VERSION,
  applyEventToStats,
  applyScore,
  buildEvent,
  emptyGameScores,
  emptyModeStats,
  newSessionId,
} from "../metadata/schemas";

suite("metadata schemas", () => {
  test("buildEvent stamps version + timestamp and preserves fields", () => {
    const e = buildEvent({ type: "session_started", sessionId: "s1", trigger: "manual" }, "2026-07-05T09:00:00.000Z");
    assert.strictEqual(e.v, INTERACTION_SCHEMA_VERSION);
    assert.strictEqual(e.timestamp, "2026-07-05T09:00:00.000Z");
    assert.strictEqual(e.type, "session_started");
    if (e.type === "session_started") {
      assert.strictEqual(e.trigger, "manual");
    }
  });

  test("session_started increments totalSessions", () => {
    const s0 = emptyModeStats();
    const s1 = applyEventToStats(
      s0,
      buildEvent({ type: "session_started", sessionId: "s1", trigger: "manual" })
    );
    assert.strictEqual(s1.totalSessions, 1);
    assert.strictEqual(s0.totalSessions, 0, "original stats must not be mutated");
  });

  test("mode_selected accumulates per-mode selections and lastUsed", () => {
    let stats = emptyModeStats();
    stats = applyEventToStats(stats, buildEvent({ type: "mode_selected", sessionId: "s1", modeId: "ambient.rainWindow" }, "2026-07-05T09:00:00.000Z"));
    stats = applyEventToStats(stats, buildEvent({ type: "mode_selected", sessionId: "s1", modeId: "ambient.rainWindow" }, "2026-07-05T09:05:00.000Z"));
    assert.strictEqual(stats.perMode["ambient.rainWindow"].selections, 2);
    assert.strictEqual(stats.perMode["ambient.rainWindow"].lastUsed, "2026-07-05T09:05:00.000Z");
  });

  test("unrelated events leave perMode untouched", () => {
    const stats = applyEventToStats(
      emptyModeStats(),
      buildEvent({ type: "session_ended", sessionId: "s1", reason: "user_stopped", durationMs: 1000 })
    );
    assert.deepStrictEqual(stats.perMode, {});
  });

  test("newSessionId is unique and shaped s_<date>_<rand>", () => {
    const a = newSessionId();
    const b = newSessionId();
    assert.match(a, /^s_\d{8}_\d{6}_[a-z0-9]+$/);
    assert.notStrictEqual(a, b);
  });
});

suite("game scores", () => {
  test("applyScore records a first score as the best", () => {
    const s = applyScore(emptyGameScores(), "microgame.meteorDodge", 12.3, "2026-07-20T00:00:00.000Z");
    assert.strictEqual(s.games["microgame.meteorDodge"].best, 12.3);
    assert.strictEqual(s.games["microgame.meteorDodge"].plays, 1);
    assert.strictEqual(s.games["microgame.meteorDodge"].lastScore, 12.3);
  });

  test("best only increases; plays and lastScore always update", () => {
    let s = applyScore(emptyGameScores(), "g", 20, "t1");
    s = applyScore(s, "g", 8, "t2");
    assert.strictEqual(s.games["g"].best, 20, "best keeps the higher value");
    assert.strictEqual(s.games["g"].lastScore, 8);
    assert.strictEqual(s.games["g"].plays, 2);
    s = applyScore(s, "g", 25, "t3");
    assert.strictEqual(s.games["g"].best, 25);
    assert.strictEqual(s.games["g"].plays, 3);
  });

  test("scores are tracked per game and inputs are not mutated", () => {
    const base = emptyGameScores();
    const s = applyScore(base, "a", 5, "t");
    applyScore(s, "b", 9, "t");
    assert.deepStrictEqual(base.games, {}, "original stays empty");
    assert.strictEqual(s.games["a"].best, 5);
    assert.strictEqual(s.games["b"], undefined, "second apply returned a new object");
  });
});
