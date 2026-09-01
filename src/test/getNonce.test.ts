import * as assert from "assert";
import { getNonce } from "../webview/getNonce";

suite("getNonce (CSP nonce)", () => {
  test("returns a non-empty base64 string", () => {
    const nonce = getNonce();
    assert.strictEqual(typeof nonce, "string");
    assert.ok(nonce.length > 0);
    assert.ok(/^[A-Za-z0-9+/=]+$/.test(nonce), `not base64: ${nonce}`);
  });

  test("encodes 16 random bytes (24-char base64 with padding)", () => {
    // 16 bytes -> ceil(16/3)*4 = 24 base64 chars
    assert.strictEqual(getNonce().length, 24);
  });

  test("mints a fresh, unpredictable value each call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(getNonce());
    }
    assert.strictEqual(seen.size, 100, "all 100 nonces were unique");
  });
});
