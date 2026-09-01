import { createAgent, tool } from "langchain";
import * as z from "zod";
import { OutputChannelLogger } from "../../logging/OutputChannelLogger";
import { Settings } from "../../config/Settings";
import { VideoKind, VideoLibrary, VideoRecord } from "../../videos/VideoLibrary";
import { YouTubeVideo, isValidVideoId, searchYouTube } from "../../videos/youtubeSource";
import { createChatModel } from "../models/OllamaModelFactory";
import { runAgentWithBudget } from "./agentRun";
import { normalizeTags, dedupeStrings } from "./tagUtils";

export interface VideoCuratorRunOptions {
  settings: Settings;
  library: VideoLibrary;
  logger: OutputChannelLogger;
  kind: VideoKind;
  target: number;
  signal: AbortSignal;
  onSaved: (record: VideoRecord) => void;
}

export interface VideoCuratorRunResult {
  saved: number;
  via: "agent" | "fallback" | "agent+fallback";
}

const AGENT_BUDGET_MS = 120000;
const AGENT_RECURSION_LIMIT = 50;

const DEFAULT_QUERIES: Record<VideoKind, string[]> = {
  programming: [
    "programming tutorial short",
    "software engineering talk",
    "developer motivation",
    "tech explained short",
    "coding tips",
    "computer science concept",
  ],
  random: [
    "funny short video",
    "oddly satisfying short",
    "amazing nature short",
    "cool science short",
    "life hack short",
    "incredible skill short",
  ],
};

const SYSTEM_PROMPT: Record<VideoKind, string> = {
  programming: `You curate a small local library of YouTube videos for a developer taking short breaks in their editor.
Goal this run: save NEW videos until the remaining count reaches zero.
Rules:
- Everything must be workplace-safe and developer-relevant (programming, technology, engineering talks, tech explainers, conference clips). Never save adult, offensive, or off-topic content.
- First call analyze_video_feedback to learn liked/disliked tags, channels, and queries.
- Prefer queries close to what the user liked; avoid disliked ones. Add one fresh developer-relevant theme for variety.
- Use search_youtube with short, concrete queries (2-5 words).
- Save promising results with save_video, passing 2-4 lowercase tags (include the query's theme). Only save videoIds returned by search_youtube.
- After a few saves, call get_progress; stop as soon as remaining is 0.
Only use the provided tools. Keep going until the target is met or you run out of useful results.`,
  random: `You curate a small local library of short, fun YouTube videos for someone taking a quick break.
Goal this run: save NEW videos until the remaining count reaches zero.
Rules:
- Everything must be workplace-safe and light: humor, oddly-satisfying, amazing nature, cool science, impressive skills. Never save adult, offensive, political, or distressing content. Keep them short.
- First call analyze_video_feedback to learn liked/disliked tags, channels, and queries.
- Prefer queries close to what the user liked; avoid disliked ones. Mix in variety across fun themes.
- Use search_youtube with short, concrete queries (2-5 words).
- Save promising results with save_video, passing 2-4 lowercase tags (include the query's theme). Only save videoIds returned by search_youtube.
- After a few saves, call get_progress; stop as soon as remaining is 0.
Only use the provided tools. Keep going until the target is met or you run out of useful results.`,
};

/**
 * Fill the video library using the LangChain agent (Ollama model), with a
 * deterministic fallback fetcher so the mode works even when Ollama is offline.
 */
export async function runVideoCurator(
  options: VideoCuratorRunOptions
): Promise<VideoCuratorRunResult> {
  const { settings, logger, target } = options;
  let savedByAgent = 0;

  if (settings.brainEnabled) {
    try {
      savedByAgent = await runAgent(options);
      logger.info(`Video curator agent saved ${savedByAgent}/${target} videos`);
    } catch (error) {
      if (options.signal.aborted) {
        throw error;
      }
      logger.info(
        `Video curator agent unavailable (${error instanceof Error ? error.message : String(error)}); using fallback fetcher`
      );
    }
  }

  let savedByFallback = 0;
  if (savedByAgent < target && !options.signal.aborted) {
    savedByFallback = await runFallbackFetch(options, target - savedByAgent);
    logger.info(`Video fallback fetcher saved ${savedByFallback} videos`);
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

async function runAgent(options: VideoCuratorRunOptions): Promise<number> {
  const { settings, library, logger, kind, target, signal } = options;
  let savedThisRun = 0;
  // Only ids the model actually saw via search may be saved (anti-hallucination).
  const offered = new Map<string, YouTubeVideo>();

  const analyzeFeedback = tool(async () => JSON.stringify(await library.feedbackSummary(kind)), {
    name: "analyze_video_feedback",
    description:
      "Analyze the user's liked and disliked videos from local history. Returns liked/disliked tags, channels, and queries to guide the next search.",
    schema: z.object({}),
  });

  const searchTool = tool(
    async (input) => {
      const { query } = input as { query: string };
      let results: YouTubeVideo[];
      try {
        results = await searchYouTube(query, signal);
      } catch (error) {
        return JSON.stringify({
          error: `search failed: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }
      const known = await library.knownVideoIds();
      const fresh = results.filter((v) => !known.has(v.videoId)).slice(0, 10);
      for (const video of fresh) {
        offered.set(video.videoId, video);
      }
      return JSON.stringify(
        fresh.map((v) => ({ videoId: v.videoId, title: v.title, channel: v.channel }))
      );
    },
    {
      name: "search_youtube",
      description:
        "Search YouTube for videos. Returns up to 10 results (videoId, title, channel) not already saved.",
      schema: z.object({
        query: z.string().min(2).max(60).describe("Short search query, e.g. 'rust programming tips'"),
      }),
    }
  );

  const saveTool = tool(
    async (input) => {
      const { videoId, tags } = input as { videoId: string; tags?: string[] };
      if (savedThisRun >= target) {
        return JSON.stringify({ saved: false, reason: "target already reached" });
      }
      const candidate = offered.get(videoId);
      if (!candidate || !isValidVideoId(videoId)) {
        return JSON.stringify({ saved: false, reason: "videoId was not returned by search_youtube" });
      }
      const record = await library.addVideo({
        videoId,
        title: candidate.title,
        channel: candidate.channel,
        query: findQueryTag(tags),
        tags: normalizeTags(tags),
        kind,
      });
      if (!record) {
        return JSON.stringify({ saved: false, reason: "already in library" });
      }
      savedThisRun += 1;
      options.onSaved(record);
      return JSON.stringify({ saved: true, remaining: target - savedThisRun });
    },
    {
      name: "save_video",
      description: "Save a YouTube video (by a videoId from search_youtube) to the local library.",
      schema: z.object({
        videoId: z.string().max(20).describe("A videoId returned by search_youtube"),
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
      const counts = await library.counts(kind);
      return JSON.stringify({
        savedThisRun,
        target,
        remaining: Math.max(0, target - savedThisRun),
        libraryTotal: counts.total,
      });
    },
    {
      name: "get_progress",
      description: "Check how many videos were saved this run and how many are still needed.",
      schema: z.object({}),
    }
  );

  const agent = createAgent({
    model: await createChatModel(settings),
    tools: [analyzeFeedback, searchTool, saveTool, getProgress],
  });

  await runAgentWithBudget({
    agent,
    messages: [
      { role: "system", content: SYSTEM_PROMPT[kind] },
      {
        role: "user",
        content: `Save ${target} new workplace-safe ${kind === "random" ? "fun" : "developer"} videos for me now. Start by analyzing my feedback.`,
      },
    ],
    signal,
    budgetMs: AGENT_BUDGET_MS,
    recursionLimit: AGENT_RECURSION_LIMIT,
    savedSoFar: () => savedThisRun,
    logger,
    label: "Video agent",
  });

  return savedThisRun;
}

// --- deterministic fallback --------------------------------------------------

async function runFallbackFetch(options: VideoCuratorRunOptions, needed: number): Promise<number> {
  const { library, logger, kind, signal } = options;
  const summary = await library.feedbackSummary(kind);
  const suffix = kind === "random" ? "short" : "programming";
  const queries = dedupeStrings([
    ...summary.likedQueries,
    ...summary.likedTags.map((t) => `${t} ${suffix}`),
    ...DEFAULT_QUERIES[kind],
  ]).filter((q) => !summary.dislikedQueries.includes(q));

  let saved = 0;
  for (const query of queries) {
    if (saved >= needed || signal.aborted) {
      break;
    }
    let results: YouTubeVideo[] = [];
    try {
      results = await searchYouTube(query, signal);
    } catch (error) {
      logger.info(
        `Fallback video search failed for "${query}": ${error instanceof Error ? error.message : "unknown"}`
      );
      continue;
    }
    const known = await library.knownVideoIds();
    for (const video of results) {
      if (saved >= needed || signal.aborted) {
        break;
      }
      if (known.has(video.videoId) || !isValidVideoId(video.videoId)) {
        continue;
      }
      const record = await library.addVideo({
        videoId: video.videoId,
        title: video.title,
        channel: video.channel,
        query,
        tags: normalizeTags(undefined, query),
        kind,
      });
      if (record) {
        saved += 1;
        known.add(video.videoId);
        options.onSaved(record);
      }
    }
  }
  return saved;
}

// --- helpers ----------------------------------------------------------------

function findQueryTag(tags: string[] | undefined): string {
  return (tags ?? []).map((t) => t.toLowerCase().trim()).find((t) => t.length >= 2) ?? "curated";
}
