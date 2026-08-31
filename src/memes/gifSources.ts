/**
 * Tenor / Giphy candidate discovery and safe downloading.
 *
 * Both sites server-render their search and category pages with direct media
 * URLs in the HTML, so candidates are found with bounded regex extraction — no
 * API keys, no JS execution, no HTML parsing of untrusted markup into the DOM.
 *
 * Security posture: downloads are restricted to an explicit host allowlist and
 * a size cap, and every request is time-bounded and abortable. URLs chosen by
 * the LLM agent go through the same `isAllowedGifUrl` gate — the model can only
 * ever save media from these hosts.
 */

export interface GifCandidate {
  mediaUrl: string;
  source: "tenor" | "giphy";
  title: string;
}

export const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB per gif
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CANDIDATES_PER_PAGE = 20;

/** Browser-like UA — both sites serve plainer/blocked pages to unknown agents. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TENOR_MEDIA_RE = /https:\/\/media\d*\.tenor\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_%.-]+\.gif/g;
const GIPHY_MEDIA_RE =
  /https:\/\/media\d*\.giphy\.com\/media\/(?:v1\.[A-Za-z0-9_=-]+\/)?[A-Za-z0-9]+\/(?:giphy|200w?|200_s)\.gif/g;

/** True when the URL points at an allowlisted GIF host over https. */
export function isAllowedGifUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  return (
    /^media\d*\.tenor\.com$/.test(parsed.hostname) ||
    /^media\d*\.giphy\.com$/.test(parsed.hostname)
  );
}

/** Extract unique Tenor media URLs from a search page's HTML. */
export function extractTenorGifUrls(html: string): string[] {
  return dedupe(html.match(TENOR_MEDIA_RE) ?? []);
}

/** Extract unique Giphy media URLs from a search/category page's HTML. */
export function extractGiphyGifUrls(html: string): string[] {
  return dedupe(html.match(GIPHY_MEDIA_RE) ?? []);
}

export async function searchTenor(query: string, signal?: AbortSignal): Promise<GifCandidate[]> {
  const slug = encodeURIComponent(query.trim().replace(/\s+/g, "-").toLowerCase());
  const html = await fetchText(`https://tenor.com/search/${slug}-gifs`, signal);
  return extractTenorGifUrls(html).map((mediaUrl) => ({ mediaUrl, source: "tenor", title: query }));
}

/** Search Giphy, or browse its memes category when no query is given. */
export async function searchGiphy(
  query: string | undefined,
  signal?: AbortSignal
): Promise<GifCandidate[]> {
  const url = query
    ? `https://giphy.com/search/${encodeURIComponent(query.trim().replace(/\s+/g, "-").toLowerCase())}`
    : "https://giphy.com/categories/memes";
  const html = await fetchText(url, signal);
  return extractGiphyGifUrls(html).map((mediaUrl) => ({
    mediaUrl,
    source: "giphy",
    title: query ?? "memes",
  }));
}

/**
 * Download a GIF from an allowlisted host. Throws on disallowed URLs, HTTP
 * errors, oversize payloads, or timeout/cancellation.
 */
export async function downloadGif(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!isAllowedGifUrl(url)) {
    throw new Error(`URL not on the allowed GIF host list: ${url}`);
  }
  const res = await timeboundFetch(url, signal);
  if (!res.ok) {
    throw new Error(`Download failed with HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_GIF_BYTES) {
    throw new Error(`GIF too large (${declared} bytes)`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_GIF_BYTES) {
    throw new Error(`GIF too large (${data.byteLength} bytes)`);
  }
  if (data.byteLength < 100) {
    throw new Error("Downloaded file is not a GIF");
  }
  return data;
}

// --- internals --------------------------------------------------------------

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)].slice(0, MAX_CANDIDATES_PER_PAGE);
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await timeboundFetch(url, signal);
  if (!res.ok) {
    throw new Error(`Fetch failed with HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

async function timeboundFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (signal?.aborted) {
    controller.abort();
  }
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
