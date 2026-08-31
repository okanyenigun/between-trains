import { randomBytes } from "crypto";

/**
 * Generates a cryptographically-random nonce used to allow-list the webview's
 * own script tags in its Content Security Policy. A fresh nonce is minted per
 * render, so an injected script can never carry a matching nonce.
 */
export function getNonce(): string {
  return randomBytes(16).toString("base64");
}
