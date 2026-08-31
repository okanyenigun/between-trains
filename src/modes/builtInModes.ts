import { ModeRegistry } from "./ModeRegistry";
import { WaitingModeDescriptor } from "./types";

/**
 * The built-in mode set for the MVP. Their interactive experiences arrive in
 * later milestones (Ambient Zen / micro-game in M7, learning cards after the
 * brain layer in M6); here they are registered so the selector and persistence
 * loop can be exercised end-to-end.
 */
export const BUILT_IN_MODES: readonly WaitingModeDescriptor[] = [
  {
    id: "microgame.meteorDodge",
    title: "Meteor Dodge",
    description: "Dodge falling meteors for as long as the agent is working.",
    category: "microgame",
    enabled: true,
  },
  {
    id: "microgame.tinyBasketball",
    title: "Tiny Basketball",
    description: "Flick the ball into the hoop. Every basket counts.",
    category: "microgame",
    enabled: true,
  },
  {
    id: "ambient.rainWindow",
    title: "Rain on Window",
    description: "A calm rain loop on glass — nothing to do but watch.",
    category: "ambient",
    enabled: true,
  },
  {
    id: "ambient.breathingOrb",
    title: "Breathing Orb",
    description: "A soft orb that expands and contracts to guide a slow breath.",
    category: "ambient",
    enabled: true,
  },
  {
    id: "physical.microBreak",
    title: "Micro-Break",
    description: "One small, optional stretch or breath at a time. Gentle, easy to skip.",
    category: "physical",
    enabled: true,
  },
  {
    id: "media.memeGifs",
    title: "Memes & GIFs",
    description:
      "Memes and GIFs fetched by your local agent — swipe right to keep, left to skip.",
    category: "media",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "media.videoRandom",
    title: "Random Videos",
    description:
      "Short, fun videos curated by your local agent — watch, like, or skip; each shown once.",
    category: "media",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "media.videoProgramming",
    title: "Programming Videos",
    description:
      "Short programming clips, explainers, and conference moments curated by your local agent.",
    category: "media",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "news.technology",
    title: "Technology",
    description: "Short technology news cards fetched by your local agent.",
    category: "news",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "news.world",
    title: "World",
    description: "Short world news cards fetched by your local agent.",
    category: "news",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "news.business",
    title: "Business",
    description: "Short business news cards fetched by your local agent.",
    category: "news",
    enabled: true,
    requiresNetwork: true,
  },
  {
    id: "news.science",
    title: "Science",
    description: "Short science news cards fetched by your local agent.",
    category: "news",
    enabled: true,
    requiresNetwork: true,
  },
  // The Learning group's entry point / manager. User-defined topics are
  // registered dynamically as `learning.topic.<id>` sub-modes beside it.
  {
    id: "learning.topics",
    title: "Topics",
    description: "Add tech topics and a level; the agent writes learning cards for each.",
    category: "learning",
    enabled: true,
  },
];

export function registerBuiltInModes(registry: ModeRegistry): void {
  for (const mode of BUILT_IN_MODES) {
    registry.register(mode);
  }
}
