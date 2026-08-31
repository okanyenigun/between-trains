/**
 * Mode-id conventions. Modes are addressed by string ids with stable prefixes;
 * these helpers are the single source of truth for recognizing a mode's family
 * and pulling the meaningful part out of its id. Shared by the controller and
 * the per-mode presenters.
 */

export const MEME_MODE_ID = "media.memeGifs";

export const VIDEO_RANDOM_ID = "media.videoRandom";
export const VIDEO_PROGRAMMING_ID = "media.videoProgramming";

export function isVideoModeId(id: string | undefined): boolean {
  return id === VIDEO_RANDOM_ID || id === VIDEO_PROGRAMMING_ID;
}

export const NEWS_MODE_IDS = ["news.technology", "news.world", "news.business", "news.science"];

export function isNewsModeId(id: string | undefined): boolean {
  return typeof id === "string" && NEWS_MODE_IDS.indexOf(id) !== -1;
}

/** Mode id `news.technology` → category `technology`. */
export function newsCategoryOf(id: string): string {
  return id.split(".")[1] ?? "technology";
}

export const LEARNING_MANAGE_ID = "learning.topics";
export const LEARNING_TOPIC_PREFIX = "learning.topic.";

export function isLearningTopicId(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith(LEARNING_TOPIC_PREFIX);
}

/** Mode id `learning.topic.<topicId>` → `<topicId>`. */
export function learningTopicIdOf(id: string): string {
  return id.slice(LEARNING_TOPIC_PREFIX.length);
}

export function levelLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}
