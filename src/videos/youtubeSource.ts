/**
 * YouTube discovery via the server-rendered search results page.
 *
 * The results page embeds an `ytInitialData` JSON blob containing
 * `videoRenderer` nodes with ids, titles, and channels. We slice that JSON out
 * with a brace-balanced scan and walk it — no API key, no browser, no untrusted
 * HTML rendered into the DOM. Nothing is downloaded; only metadata is kept, and
 * playback happens in a sandboxed youtube-nocookie iframe in the webview.
 */

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS = 25;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** True when the string is a syntactically valid YouTube video id. */
export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

/** Extract unique videos from a YouTube results page's HTML. */
export function extractYouTubeVideos(html: string): YouTubeVideo[] {
  const out: YouTubeVideo[] = [];
  const seen = new Set<string>();

  const data = extractYtInitialData(html);
  if (data) {
    collectVideoRenderers(data, (vr) => {
      const videoId = typeof vr.videoId === "string" ? vr.videoId : "";
      if (!VIDEO_ID_RE.test(videoId) || seen.has(videoId)) {
        return;
      }
      seen.add(videoId);
      out.push({
        videoId,
        title: runsText(vr.title) || "YouTube video",
        channel:
          runsText(vr.ownerText) ||
          runsText(vr.longBylineText) ||
          runsText(vr.shortBylineText) ||
          "",
        duration: simpleText(vr.lengthText),
      });
    });
  }

  if (out.length === 0) {
    // Fallback: ids only, from anywhere in the HTML.
    for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      const id = match[1];
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ videoId: id, title: "YouTube video", channel: "", duration: "" });
      }
    }
  }

  return out.slice(0, MAX_RESULTS);
}

export async function searchYouTube(
  query: string,
  signal?: AbortSignal
): Promise<YouTubeVideo[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
  const html = await fetchText(url, signal);
  return extractYouTubeVideos(html);
}

// --- internals --------------------------------------------------------------

function extractYtInitialData(html: string): Record<string, unknown> | undefined {
  const markers = ["var ytInitialData = ", "ytInitialData = ", 'ytInitialData"] = '];
  for (const marker of markers) {
    const at = html.indexOf(marker);
    if (at === -1) {
      continue;
    }
    const start = html.indexOf("{", at + marker.length);
    if (start === -1) {
      continue;
    }
    const slice = sliceBalancedObject(html, start);
    if (!slice) {
      continue;
    }
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      // try the next marker
    }
  }
  return undefined;
}

/** Return the substring of a balanced `{...}` starting at `start`, or undefined. */
function sliceBalancedObject(source: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

type RunsField = { runs?: { text?: unknown }[] };
type SimpleField = { simpleText?: unknown };

function collectVideoRenderers(
  node: unknown,
  cb: (vr: Record<string, RunsField & SimpleField & { videoId?: unknown }>) => void
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, cb);
    }
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.videoRenderer && typeof obj.videoRenderer === "object") {
      cb(obj.videoRenderer as Parameters<typeof cb>[0]);
    }
    for (const key of Object.keys(obj)) {
      collectVideoRenderers(obj[key], cb);
    }
  }
}

function runsText(field: unknown): string {
  const runs = (field as RunsField | undefined)?.runs;
  if (!Array.isArray(runs)) {
    return "";
  }
  return runs
    .map((r) => (typeof r?.text === "string" ? r.text : ""))
    .join("")
    .trim();
}

function simpleText(field: unknown): string {
  const value = (field as SimpleField | undefined)?.simpleText;
  return typeof value === "string" ? value : "";
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (signal?.aborted) {
    controller.abort();
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) {
      throw new Error(`YouTube search failed with HTTP ${res.status}`);
    }
    return res.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
