import { createAgent, tool } from "langchain";
import * as z from "zod";
import { OutputChannelLogger } from "../../logging/OutputChannelLogger";
import { Settings } from "../../config/Settings";
import { GifLibrary, GifRecord } from "../../memes/GifLibrary";
import {
  GifCandidate,
  downloadGif,
  isAllowedGifUrl,
  searchGiphy,
  searchTenor,
} from "../../memes/gifSources";
import { createChatModel } from "../models/OllamaModelFactory";
import { runAgentWithBudget } from "./agentRun";
import { normalizeTags, dedupeStrings } from "./tagUtils";

export interface CuratorRunOptions {
  settings: Settings;
  library: GifLibrary;
  logger: OutputChannelLogger;
  /** How many NEW gifs this run should save. */
  target: number;
  signal: AbortSignal;
  /** Called after every successful save (for status updates + event logging). */
  onSaved: (record: GifRecord) => void;
}

export interface CuratorRunResult {
  saved: number;
  via: "agent" | "fallback" | "agent+fallback";
}

const AGENT_BUDGET_MS = 120000;
const AGENT_RECURSION_LIMIT = 50;

const DEFAULT_QUERIES = [
  "programming memes",
  "developer memes",
  "funny cat",
  "office humor",
  "coding waiting",
  "monday mood",
];

const SYSTEM_PROMPT = `You curate a small local library of memes and GIFs for a developer taking short breaks inside their code editor.
Your goal this run: save NEW gifs until the remaining count reaches zero.
Rules:
- Everything must be workplace-safe humor. Never save offensive, violent, or adult content.
- First call analyze_gif_feedback to learn what the user likes and dislikes.
- Prefer search queries close to liked tags/queries; avoid disliked ones. Mix in one fresh theme for variety.
- Use search_gifs on both "tenor" and "giphy" with short, concrete queries (2-4 words).
- Save promising candidates with save_gif, passing 2-4 lowercase descriptive tags (include the query's theme).
- After a few saves, call get_progress; stop as soon as remaining is 0.
Only use the provided tools. Keep going until the target is met or you run out of useful candidates.`;

/**
 * Try to fill the library using the LangChain agent (tool-calling Ollama
 * model). Falls back to the deterministic fetcher for any shortfall, so the
 * feature works even when Ollama is offline or the model can't call tools.
 */
export async function runMemeCurator(options: CuratorRunOptions): Promise<CuratorRunResult> {
  const { settings, logger, target } = options;
  let savedByAgent = 0;

  if (settings.brainEnabled) {
    try {
      savedByAgent = await runAgent(options);
      logger.info(`Meme curator agent saved ${savedByAgent}/${target} gifs`);
    } catch (error) {
      if (options.signal.aborted) {
        throw error;
      }
      logger.info(
        `Meme curator agent unavailable (${error instanceof Error ? error.message : String(error)}); using fallback fetcher`
      );
    }
  }

  let savedByFallback = 0;
  if (savedByAgent < target && !options.signal.aborted) {
    savedByFallback = await runFallbackFetch(options, target - savedByAgent);
    logger.info(`Meme fallback fetcher saved ${savedByFallback} gifs`);
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

async function runAgent(options: CuratorRunOptions): Promise<number> {
  const { settings, library, logger, target, signal } = options;
  let savedThisRun = 0;

  const analyzeFeedback = tool(
    async () => JSON.stringify(await library.feedbackSummary()),
    {
      name: "analyze_gif_feedback",
      description:
        "Analyze the user's likes and dislikes from local interaction history. Returns liked/disliked tags and queries to guide what to search for next.",
      schema: z.object({}),
    }
  );

  const searchGifs = tool(
    async (input) => {
      const { source, query } = input as { source: "tenor" | "giphy"; query: string };
      const known = await library.knownUrls();
      let candidates: GifCandidate[];
      try {
        candidates =
          source === "tenor" ? await searchTenor(query, signal) : await searchGiphy(query, signal);
      } catch (error) {
        return JSON.stringify({
          error: `search failed: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }
      const fresh = candidates.filter((c) => !known.has(c.mediaUrl)).slice(0, 12);
      return JSON.stringify(fresh.map((c) => ({ url: c.mediaUrl, source: c.source })));
    },
    {
      name: "search_gifs",
      description:
        "Search a GIF source for candidates. Returns up to 12 media URLs not already in the library.",
      schema: z.object({
        source: z.enum(["tenor", "giphy"]).describe("Which site to search"),
        query: z.string().min(2).max(60).describe("Short search query, e.g. 'programming memes'"),
      }),
    }
  );

  const saveGif = tool(
    async (input) => {
      const { url, query, tags } = input as { url: string; query: string; tags?: string[] };
      if (savedThisRun >= target) {
        return JSON.stringify({ saved: false, reason: "target already reached" });
      }
      if (!isAllowedGifUrl(url)) {
        return JSON.stringify({ saved: false, reason: "url not on the allowed host list" });
      }
      const known = await library.knownUrls();
      if (known.has(url)) {
        return JSON.stringify({ saved: false, reason: "already in library" });
      }
      try {
        const data = await downloadGif(url, signal);
        const record = await library.addGif(
          {
            source: url.includes("tenor.com") ? "tenor" : "giphy",
            mediaUrl: url,
            title: query,
            query,
            tags: normalizeTags(tags, query),
          },
          data
        );
        savedThisRun += 1;
        options.onSaved(record);
        return JSON.stringify({ saved: true, remaining: target - savedThisRun });
      } catch (error) {
        return JSON.stringify({
          saved: false,
          reason: error instanceof Error ? error.message : "download failed",
        });
      }
    },
    {
      name: "save_gif",
      description:
        "Download a candidate GIF URL (from search_gifs) and save it to the local library with tags.",
      schema: z.object({
        url: z.string().max(500).describe("A media URL returned by search_gifs"),
        query: z.string().min(2).max(60).describe("The search query this gif came from"),
        tags: z
          .array(z.string().min(2).max(24))
          .max(4)
          .optional()
          .describe("2-4 lowercase descriptive tags"),
      }),
    }
  );

  const getProgress = tool(
    async () => {
      const counts = await library.counts();
      return JSON.stringify({
        savedThisRun,
        target,
        remaining: Math.max(0, target - savedThisRun),
        libraryTotal: counts.total,
      });
    },
    {
      name: "get_progress",
      description: "Check how many gifs were saved this run and how many are still needed.",
      schema: z.object({}),
    }
  );

  const agent = createAgent({
    model: await createChatModel(settings),
    tools: [analyzeFeedback, searchGifs, saveGif, getProgress],
  });

  await runAgentWithBudget({
    agent,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Save ${target} new workplace-safe gifs for me now. Start by analyzing my feedback.`,
      },
    ],
    signal,
    budgetMs: AGENT_BUDGET_MS,
    recursionLimit: AGENT_RECURSION_LIMIT,
    savedSoFar: () => savedThisRun,
    logger,
    label: "Meme agent",
  });

  return savedThisRun;
}

// --- deterministic fallback --------------------------------------------------

/**
 * No-LLM path: derive queries from liked feedback (plus safe defaults), search
 * both sources round-robin, and save fresh candidates until the target is met.
 */
async function runFallbackFetch(options: CuratorRunOptions, needed: number): Promise<number> {
  const { library, logger, signal } = options;
  const summary = await library.feedbackSummary();
  const queries = dedupeStrings([
    ...summary.likedQueries,
    ...summary.likedTags.map((t) => `${t} meme`),
    ...DEFAULT_QUERIES,
  ]).filter((q) => !summary.dislikedQueries.includes(q));

  let saved = 0;
  for (const query of queries) {
    if (saved >= needed || signal.aborted) {
      break;
    }
    for (const source of ["tenor", "giphy"] as const) {
      if (saved >= needed || signal.aborted) {
        break;
      }
      let candidates: GifCandidate[] = [];
      try {
        candidates =
          source === "tenor"
            ? await searchTenor(query, signal)
            : await searchGiphy(query, signal);
      } catch (error) {
        logger.info(
          `Fallback search failed for "${query}" on ${source}: ${error instanceof Error ? error.message : "unknown"}`
        );
        continue;
      }
      const known = await library.knownUrls();
      for (const candidate of candidates) {
        if (saved >= needed || signal.aborted) {
          break;
        }
        if (known.has(candidate.mediaUrl)) {
          continue;
        }
        try {
          const data = await downloadGif(candidate.mediaUrl, signal);
          const record = await library.addGif(
            {
              source: candidate.source,
              mediaUrl: candidate.mediaUrl,
              title: candidate.title,
              query,
              tags: normalizeTags(undefined, query),
            },
            data
          );
          saved += 1;
          known.add(candidate.mediaUrl);
          options.onSaved(record);
        } catch {
          // skip broken candidates silently; plenty more to try
        }
      }
    }
  }
  return saved;
}

