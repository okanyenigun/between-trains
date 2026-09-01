import { createAgent, tool } from "langchain";
import * as z from "zod";
import { OutputChannelLogger } from "../../logging/OutputChannelLogger";
import { Settings } from "../../config/Settings";
import { NewsProvider } from "../../config/SecretsStore";
import { NewsLibrary, NewsRecord } from "../../news/NewsLibrary";
import { NewsResult, searchNews } from "../../news/searchProviders";
import { createChatModel } from "../models/OllamaModelFactory";
import { runAgentWithBudget } from "./agentRun";

export interface NewsCuratorRunOptions {
  settings: Settings;
  provider: NewsProvider;
  apiKey: string;
  library: NewsLibrary;
  logger: OutputChannelLogger;
  category: string;
  target: number;
  signal: AbortSignal;
  onSaved: (record: NewsRecord) => void;
}

export interface NewsCuratorRunResult {
  saved: number;
  via: "agent" | "fallback" | "agent+fallback";
}

const AGENT_BUDGET_MS = 120000;
const AGENT_RECURSION_LIMIT = 40;
const MAX_SUMMARY = 320;

/** Seed queries per news category. */
const CATEGORY_QUERIES: Record<string, string[]> = {
  technology: ["latest technology news", "software and AI news", "gadgets and tech news"],
  world: ["world news today", "international headlines", "global affairs news"],
  business: ["business news today", "markets and economy news", "startup and finance news"],
  science: ["science news", "space and physics news", "research breakthroughs news"],
};

function queriesFor(category: string): string[] {
  return CATEGORY_QUERIES[category] ?? [`${category} news`];
}

/**
 * Fill the news library for one category using the LangChain agent (Ollama
 * writes concise card summaries and chooses sub-queries), with a deterministic
 * fallback that turns provider snippets straight into cards.
 */
export async function runNewsCurator(
  options: NewsCuratorRunOptions,
): Promise<NewsCuratorRunResult> {
  const { settings, logger, target } = options;
  let savedByAgent = 0;

  if (settings.brainEnabled) {
    try {
      savedByAgent = await runAgent(options);
      logger.info(`News agent saved ${savedByAgent}/${target} cards`);
    } catch (error) {
      if (options.signal.aborted) {
        throw error;
      }
      logger.info(
        `News agent unavailable (${error instanceof Error ? error.message : String(error)}); using fallback`,
      );
    }
  }

  let savedByFallback = 0;
  if (savedByAgent < target && !options.signal.aborted) {
    savedByFallback = await runFallback(options, target - savedByAgent);
    logger.info(`News fallback saved ${savedByFallback} cards`);
  }

  const via =
    savedByAgent > 0 && savedByFallback > 0
      ? "agent+fallback"
      : savedByAgent > 0
        ? "agent"
        : "fallback";
  return { saved: savedByAgent + savedByFallback, via };
}

// --- agent path -------------------------------------------------------------

async function runAgent(options: NewsCuratorRunOptions): Promise<number> {
  const { settings, provider, apiKey, library, logger, category, target, signal } = options;
  let savedThisRun = 0;
  const offered = new Map<string, NewsResult>();

  const searchTool = tool(
    async (input) => {
      const { query } = input as { query: string };
      let results: NewsResult[];
      try {
        results = await searchNews(provider, query, apiKey, 10, signal);
      } catch (error) {
        return JSON.stringify({
          error: `search failed: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }
      const known = await library.knownUrls(category);
      const fresh = results.filter((r) => !known.has(r.url)).slice(0, 8);
      for (const r of fresh) {
        offered.set(r.url, r);
      }
      return JSON.stringify(
        fresh.map((r) => ({ url: r.url, title: r.title, source: r.source, snippet: r.snippet })),
      );
    },
    {
      name: "search_news",
      description:
        "Search the web for recent news on a topic. Returns up to 8 results not already saved.",
      schema: z.object({
        query: z.string().min(2).max(80).describe("A concrete news query, e.g. 'AI chip news'"),
      }),
    },
  );

  const saveTool = tool(
    async (input) => {
      const { url, headline, summary } = input as {
        url: string;
        headline: string;
        summary: string;
      };
      if (savedThisRun >= target) {
        return JSON.stringify({ saved: false, reason: "target reached" });
      }
      const source = offered.get(url);
      if (!source) {
        return JSON.stringify({ saved: false, reason: "url was not returned by search_news" });
      }
      const record = await library.addCard({
        category,
        headline: headline.trim().slice(0, 160) || source.title,
        summary: summary.trim().slice(0, MAX_SUMMARY) || source.snippet,
        source: source.source,
        url,
        publishedAt: source.publishedAt,
      });
      if (!record) {
        return JSON.stringify({ saved: false, reason: "already saved" });
      }
      savedThisRun += 1;
      options.onSaved(record);
      return JSON.stringify({ saved: true, remaining: target - savedThisRun });
    },
    {
      name: "save_news_card",
      description:
        "Save a news card (from a search_news url) with a short headline and a concise 1-2 sentence summary.",
      schema: z.object({
        url: z.string().max(500).describe("A url returned by search_news"),
        headline: z.string().min(4).max(160),
        summary: z.string().min(10).max(320).describe("1-2 sentences, plain text"),
      }),
    },
  );

  const agent = createAgent({ model: await createChatModel(settings), tools: [searchTool, saveTool] });

  await runAgentWithBudget({
    agent,
    messages: [
      {
        role: "system",
        content:
          "You curate short, workplace-safe news cards for a developer's break. " +
          `Save ${target} NEW cards about the "${category}" category. ` +
          "Search with search_news, then save the most interesting, credible items with save_news_card, " +
          "writing a concise, neutral 1-2 sentence summary for each. Only save urls returned by search_news. " +
          "Avoid duplicates and low-quality clickbait. Stop once the target is reached.",
      },
      {
        role: "user",
        content: `Find and save ${target} ${category} news cards. Suggested queries: ${queriesFor(category).join(", ")}.`,
      },
    ],
    signal,
    budgetMs: AGENT_BUDGET_MS,
    recursionLimit: AGENT_RECURSION_LIMIT,
    savedSoFar: () => savedThisRun,
    logger,
    label: "News agent",
  });

  return savedThisRun;
}

// --- deterministic fallback --------------------------------------------------

async function runFallback(options: NewsCuratorRunOptions, needed: number): Promise<number> {
  const { provider, apiKey, library, logger, category, signal } = options;
  let saved = 0;

  for (const query of queriesFor(category)) {
    if (saved >= needed || signal.aborted) {
      break;
    }
    let results: NewsResult[];
    try {
      results = await searchNews(provider, query, apiKey, 10, signal);
    } catch (error) {
      logger.info(
        `News fallback search failed for "${query}": ${error instanceof Error ? error.message : "unknown"}`,
      );
      continue;
    }
    const known = await library.knownUrls(category);
    for (const r of results) {
      if (saved >= needed || signal.aborted) {
        break;
      }
      if (known.has(r.url) || !r.title || !r.url) {
        continue;
      }
      const record = await library.addCard({
        category,
        headline: r.title.slice(0, 160),
        summary: (r.snippet || r.title).slice(0, MAX_SUMMARY),
        source: r.source,
        url: r.url,
        publishedAt: r.publishedAt,
      });
      if (record) {
        saved += 1;
        known.add(r.url);
        options.onSaved(record);
      }
    }
  }
  return saved;
}
