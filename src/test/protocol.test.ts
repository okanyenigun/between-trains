import * as assert from "assert";
import { isWebviewToExtension } from "../webview/protocol";

suite("isWebviewToExtension (inbound message validation)", () => {
  test("rejects non-objects and null", () => {
    assert.strictEqual(isWebviewToExtension(null), false);
    assert.strictEqual(isWebviewToExtension(undefined), false);
    assert.strictEqual(isWebviewToExtension("panel/ready"), false);
    assert.strictEqual(isWebviewToExtension(42), false);
    assert.strictEqual(isWebviewToExtension([]), false, "array has no string type");
  });

  test("rejects unknown / missing message types", () => {
    assert.strictEqual(isWebviewToExtension({}), false);
    assert.strictEqual(isWebviewToExtension({ type: 123 }), false);
    assert.strictEqual(isWebviewToExtension({ type: "does/notExist" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "" }), false);
  });

  test("accepts no-argument messages by type alone", () => {
    assert.strictEqual(isWebviewToExtension({ type: "panel/ready" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "session/stop" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "meme/next" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "config/openStats" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "learning/addTopic" }), true);
  });

  test("id-carrying messages require a string id", () => {
    assert.strictEqual(isWebviewToExtension({ type: "mode/select", id: "media.memeGifs" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "mode/select" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "mode/select", id: 7 }), false);
    assert.strictEqual(isWebviewToExtension({ type: "news/openLink", id: "n_1" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "learning/removeTopic", id: "t_1" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "learning/removeTopic" }), false);
  });

  test("value-carrying config messages require a string value", () => {
    assert.strictEqual(isWebviewToExtension({ type: "config/setProvider", value: "ollama" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "config/setProvider" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "config/setModel", value: 3 }), false);
    assert.strictEqual(isWebviewToExtension({ type: "config/setNewsProvider", value: "brave" }), true);
  });

  test("game/started + game/statsRequest require a string gameId", () => {
    assert.strictEqual(isWebviewToExtension({ type: "game/started", gameId: "microgame.meteorDodge" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "game/started" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "game/statsRequest", gameId: 1 }), false);
  });

  test("game/completed: gameId required, score optional but finite number when present", () => {
    assert.strictEqual(isWebviewToExtension({ type: "game/completed", gameId: "g" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "game/completed", gameId: "g", score: 120 }), true);
    assert.strictEqual(isWebviewToExtension({ type: "game/completed", gameId: "g", score: "120" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "game/completed", gameId: "g", score: NaN }), false);
    assert.strictEqual(isWebviewToExtension({ type: "game/completed" }), false);
  });

  test("rate messages require id string + a boolean flag", () => {
    assert.strictEqual(isWebviewToExtension({ type: "meme/rate", id: "g1", liked: true }), true);
    assert.strictEqual(isWebviewToExtension({ type: "meme/rate", id: "g1", liked: "yes" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "meme/rate", id: "g1" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "video/rate", id: "v1", liked: false }), true);
    assert.strictEqual(isWebviewToExtension({ type: "learning/rate", id: "l1", known: true }), true);
    assert.strictEqual(isWebviewToExtension({ type: "learning/rate", id: "l1", known: 1 }), false);
  });

  test("video/replay + video/openExternal require their string id fields", () => {
    assert.strictEqual(isWebviewToExtension({ type: "video/replay", id: "v1" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "video/replay" }), false);
    assert.strictEqual(isWebviewToExtension({ type: "video/openExternal", videoId: "abcdefghijk" }), true);
    assert.strictEqual(isWebviewToExtension({ type: "video/openExternal", videoId: 5 }), false);
  });

  test("setAutoFetch messages require a boolean value across all modes", () => {
    for (const type of [
      "meme/setAutoFetch",
      "video/setAutoFetch",
      "news/setAutoFetch",
      "learning/setAutoFetch",
    ]) {
      assert.strictEqual(isWebviewToExtension({ type, value: true }), true, `${type} accepts boolean`);
      assert.strictEqual(isWebviewToExtension({ type, value: "true" }), false, `${type} rejects string`);
      assert.strictEqual(isWebviewToExtension({ type }), false, `${type} requires value`);
    }
  });
});
