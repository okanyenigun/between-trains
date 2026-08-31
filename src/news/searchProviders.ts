import { NewsProvider } from "../config/SecretsStore";

/** A normalized news search result from any provider. */
export interface NewsResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt?: string;
}

const REQUEST_TIMEOUT_MS = 15000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// --- pure response normalizers (unit-tested) --------------------------------

export function normalizeTavily(json: unknown): NewsResult[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((r) => {
      const o = r as Record<string, unknown>;
      const url = clean(o.url);
      return {
        title: clean(o.title),
        url,
        source: hostOf(url),
        snippet: clean(o.content),
        publishedAt: clean(o.published_date) || undefined,
      };
    })
    .filter((r) => r.title && r.url);
}

export function normalizeBrave(json: unknown): NewsResult[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((r) => {
      const o = r as Record<string, unknown>;
      const url = clean(o.url);
      const meta = o.meta_url as { hostname?: unknown } | undefined;
      return {
        title: clean(o.title),
        url,
        source: clean(meta?.hostname) || hostOf(url),
        snippet: clean(o.description),
        publishedAt: clean(o.age) || clean(o.page_age) || undefined,
      };
    })
    .filter((r) => r.title && r.url);
}

export function normalizeSerper(json: unknown): NewsResult[] {
  const news = (json as { news?: unknown[] })?.news;
  if (!Array.isArray(news)) {
    return [];
  }
  return news
    .map((r) => {
      const o = r as Record<string, unknown>;
      const url = clean(o.link);
      return {
        title: clean(o.title),
        url,
        source: clean(o.source) || hostOf(url),
        snippet: clean(o.snippet),
        publishedAt: clean(o.date) || undefined,
      };
    })
    .filter((r) => r.title && r.url);
}

// --- network calls ----------------------------------------------------------

/** Search a provider for news. Throws on HTTP/network errors and timeout. */
export async function searchNews(
  provider: NewsProvider,
  query: string,
  apiKey: string,
  count: number,
  signal?: AbortSignal,
): Promise<NewsResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (signal?.aborted) {
    controller.abort();
  }
  try {
    if (provider === "tavily") {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          topic: "news",
          max_results: count,
          search_depth: "basic",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Tavily responded HTTP ${res.status}`);
      }
      return normalizeTavily(await res.json());
    }

    if (provider === "brave") {
      const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}`;
      const res = await fetch(url, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Brave responded HTTP ${res.status}`);
      }
      return normalizeBrave(await res.json());
    }

    // serper
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: count }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Serper responded HTTP ${res.status}`);
    }
    return normalizeSerper(await res.json());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}
