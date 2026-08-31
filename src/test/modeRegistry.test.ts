import * as assert from "assert";
import { ModeRegistry } from "../modes/ModeRegistry";
import { resolveModeId } from "../modes/resolveModeId";
import { registerBuiltInModes } from "../modes/builtInModes";
import { WaitingModeDescriptor } from "../modes/types";

function make(id: string, category: WaitingModeDescriptor["category"], enabled = true): WaitingModeDescriptor {
  return { id, title: id, description: id, category, enabled };
}

suite("ModeRegistry", () => {
  test("registers, looks up, and lists in order", () => {
    const r = new ModeRegistry();
    r.register(make("a.one", "ambient"));
    r.register(make("b.two", "microgame"));
    assert.deepStrictEqual(
      r.list().map((m) => m.id),
      ["a.one", "b.two"]
    );
    assert.strictEqual(r.has("a.one"), true);
    assert.strictEqual(r.get("b.two")?.category, "microgame");
  });

  test("rejects duplicate ids", () => {
    const r = new ModeRegistry();
    r.register(make("dup", "ambient"));
    assert.throws(() => r.register(make("dup", "microgame")));
  });

  test("listEnabled and defaultModeId skip disabled modes", () => {
    const r = new ModeRegistry();
    r.register(make("off", "ambient", false));
    r.register(make("on", "microgame", true));
    assert.deepStrictEqual(
      r.listEnabled().map((m) => m.id),
      ["on"]
    );
    assert.strictEqual(r.defaultModeId, "on");
  });

  test("built-in modes register in order; default is the first enabled mode", () => {
    const r = new ModeRegistry();
    registerBuiltInModes(r);
    assert.strictEqual(r.defaultModeId, "microgame.meteorDodge");
    assert.deepStrictEqual(
      r.listEnabled().map((m) => m.id),
      [
        "microgame.meteorDodge",
        "microgame.tinyBasketball",
        "ambient.rainWindow",
        "ambient.breathingOrb",
        "physical.microBreak",
        "media.memeGifs",
        "media.videoRandom",
        "media.videoProgramming",
        "news.technology",
        "news.world",
        "news.business",
        "news.science",
        "learning.topics",
      ]
    );
    assert.strictEqual(r.get("learning.topics")?.enabled, true);
    assert.strictEqual(r.get("media.memeGifs")?.requiresNetwork, true);
    assert.strictEqual(r.get("media.videoProgramming")?.requiresNetwork, true);
  });
});

suite("resolveModeId", () => {
  const registry = new ModeRegistry();
  registerBuiltInModes(registry);

  test("lastUsed → the last mode when still valid and enabled", () => {
    assert.strictEqual(
      resolveModeId("lastUsed", "microgame.tinyBasketball", registry),
      "microgame.tinyBasketball"
    );
  });

  test("lastUsed → default when last is missing, unknown, or disabled", () => {
    assert.strictEqual(resolveModeId("lastUsed", undefined, registry), "microgame.meteorDodge");
    assert.strictEqual(resolveModeId("lastUsed", "does.notExist", registry), "microgame.meteorDodge");
    // a registered-but-disabled mode falls back to the default
    const r2 = new ModeRegistry();
    registerBuiltInModes(r2);
    r2.register(make("x.disabled", "microgame", false));
    assert.strictEqual(resolveModeId("lastUsed", "x.disabled", r2), "microgame.meteorDodge");
  });

  test("category preference → first enabled mode in that category", () => {
    assert.strictEqual(resolveModeId("microgame", undefined, registry), "microgame.meteorDodge");
    assert.strictEqual(resolveModeId("ambient", undefined, registry), "ambient.rainWindow");
    assert.strictEqual(resolveModeId("learning", undefined, registry), "learning.topics");
  });

  test("category preference with no enabled modes → default", () => {
    const r2 = new ModeRegistry();
    r2.register(make("p.on", "microgame", true));
    r2.register(make("l.off", "learning", false));
    assert.strictEqual(resolveModeId("learning", undefined, r2), "p.on");
  });

  test("unknown preference → default", () => {
    assert.strictEqual(resolveModeId("nonsense", undefined, registry), "microgame.meteorDodge");
  });
});
