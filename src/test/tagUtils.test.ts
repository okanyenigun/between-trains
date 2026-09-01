import * as assert from "assert";
import { dedupeStrings, normalizeTags } from "../brain/agents/tagUtils";

suite("tag utils", () => {
  test("dedupeStrings trims, drops empties, and removes duplicates (order preserved)", () => {
    assert.deepStrictEqual(dedupeStrings([" a ", "b", "a", "", "  ", "b"]), ["a", "b"]);
    assert.deepStrictEqual(dedupeStrings([]), []);
  });

  test("normalizeTags lowercases and length-bounds the supplied tags", () => {
    assert.deepStrictEqual(normalizeTags(["React", "X", "HOOKS"]), ["react", "hooks"], "drops the 1-char 'X'");
    // a 25-char tag exceeds the 24-char cap and is dropped
    assert.deepStrictEqual(normalizeTags(["x".repeat(25)]), []);
  });

  test("normalizeTags folds in up to two words (len >= 3) from the query", () => {
    assert.deepStrictEqual(normalizeTags(undefined, "funny cat memes"), ["funny", "cat"]);
    assert.deepStrictEqual(normalizeTags(["cat"], "funny cat memes"), ["cat", "funny"], "no duplicate 'cat'");
  });

  test("normalizeTags caps the result at five tags", () => {
    const out = normalizeTags(["aa", "bb", "cc", "dd", "ee", "ff", "gg"]);
    assert.strictEqual(out.length, 5);
    assert.deepStrictEqual(out, ["aa", "bb", "cc", "dd", "ee"]);
  });

  test("normalizeTags handles no tags and no query", () => {
    assert.deepStrictEqual(normalizeTags(undefined), []);
    assert.deepStrictEqual(normalizeTags([]), []);
  });
});
