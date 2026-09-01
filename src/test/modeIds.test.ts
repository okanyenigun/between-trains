import * as assert from "assert";
import {
  LEARNING_MANAGE_ID,
  LEARNING_TOPIC_PREFIX,
  MEME_MODE_ID,
  VIDEO_PROGRAMMING_ID,
  VIDEO_RANDOM_ID,
  isLearningTopicId,
  isNewsModeId,
  isVideoModeId,
  learningTopicIdOf,
  levelLabel,
  newsCategoryOf,
} from "../waiting-room/modeIds";

suite("modeIds conventions", () => {
  test("isVideoModeId matches only the two video sub-modes", () => {
    assert.strictEqual(isVideoModeId(VIDEO_RANDOM_ID), true);
    assert.strictEqual(isVideoModeId(VIDEO_PROGRAMMING_ID), true);
    assert.strictEqual(isVideoModeId(MEME_MODE_ID), false);
    assert.strictEqual(isVideoModeId("media.video"), false);
    assert.strictEqual(isVideoModeId(undefined), false);
  });

  test("isNewsModeId matches the four registered news categories", () => {
    assert.strictEqual(isNewsModeId("news.technology"), true);
    assert.strictEqual(isNewsModeId("news.science"), true);
    assert.strictEqual(isNewsModeId("news.sports"), false, "not a registered category");
    assert.strictEqual(isNewsModeId("news"), false);
    assert.strictEqual(isNewsModeId(undefined), false);
  });

  test("newsCategoryOf extracts the category segment", () => {
    assert.strictEqual(newsCategoryOf("news.technology"), "technology");
    assert.strictEqual(newsCategoryOf("news.world"), "world");
    assert.strictEqual(newsCategoryOf("news"), "technology", "falls back when no segment");
  });

  test("isLearningTopicId matches the topic prefix but not the manage view", () => {
    assert.strictEqual(isLearningTopicId(LEARNING_TOPIC_PREFIX + "t_abc"), true);
    assert.strictEqual(isLearningTopicId(LEARNING_MANAGE_ID), false);
    assert.strictEqual(isLearningTopicId("learning.topic"), false, "prefix without a trailing dot+id");
    assert.strictEqual(isLearningTopicId(undefined), false);
  });

  test("learningTopicIdOf strips the prefix, round-tripping with the prefix", () => {
    assert.strictEqual(learningTopicIdOf(LEARNING_TOPIC_PREFIX + "t_xyz"), "t_xyz");
    const id = "t_20260101_ab";
    assert.strictEqual(learningTopicIdOf(LEARNING_TOPIC_PREFIX + id), id);
  });

  test("levelLabel capitalizes the first letter", () => {
    assert.strictEqual(levelLabel("beginner"), "Beginner");
    assert.strictEqual(levelLabel("intermediate"), "Intermediate");
    assert.strictEqual(levelLabel("advanced"), "Advanced");
    assert.strictEqual(levelLabel(""), "");
  });
});
