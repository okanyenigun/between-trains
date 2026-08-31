import * as vscode from "vscode";

/**
 * Builds a strict Content Security Policy for the waiting-room webview.
 *
 * - `default-src 'none'` denies everything, then we open the minimum needed.
 * - Scripts run only if they carry the per-render `nonce` (no inline/remote JS).
 * - Styles, fonts, and images are limited to the extension's own resources
 *   (plus `data:` images). No network origins are permitted on open.
 */
export function buildCsp(webview: vscode.Webview, nonce: string): string {
  return [
    "default-src 'none'",
    // youtube thumbnails for the video mode posters + liked list
    `img-src ${webview.cspSource} data: https://i.ytimg.com`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
}
