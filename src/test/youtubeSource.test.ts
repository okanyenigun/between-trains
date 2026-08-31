import * as assert from "assert";
import { extractYouTubeVideos, isValidVideoId } from "../videos/youtubeSource";

function pageWith(data: unknown): string {
  return `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
}

suite("youtube source", () => {
  test("extracts videoRenderers from ytInitialData (deduped, valid ids)", () => {
    const html = pageWith({
      contents: {
        twoColumn: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: "abcdefghijk",
                          title: { runs: [{ text: "Learn " }, { text: "Rust" }] },
                          ownerText: { runs: [{ text: "Rustaceans" }] },
                          lengthText: { simpleText: "10:12" },
                        },
                      },
                      {
                        videoRenderer: {
                          videoId: "abcdefghijk", // duplicate id
                          title: { runs: [{ text: "dup" }] },
                        },
                      },
                      {
                        videoRenderer: {
                          videoId: "SHORT", // invalid id, skipped
                          title: { runs: [{ text: "bad" }] },
                        },
                      },
                      {
                        videoRenderer: {
                          videoId: "ZYXWVUTS_-1",
                          title: { runs: [{ text: "TypeScript tips" }] },
                          longBylineText: { runs: [{ text: "TS Channel" }] },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    });

    const videos = extractYouTubeVideos(html);
    assert.deepStrictEqual(
      videos.map((v) => v.videoId),
      ["abcdefghijk", "ZYXWVUTS_-1"]
    );
    assert.strictEqual(videos[0].title, "Learn Rust");
    assert.strictEqual(videos[0].channel, "Rustaceans");
    assert.strictEqual(videos[0].duration, "10:12");
    assert.strictEqual(videos[1].channel, "TS Channel");
  });

  test("falls back to raw videoId regex when ytInitialData is absent", () => {
    const html =
      '<html>..."videoId":"11charIDzz1"... "videoId":"11charIDzz1" ..."videoId":"another_id1"...</html>';
    const videos = extractYouTubeVideos(html);
    assert.deepStrictEqual(
      videos.map((v) => v.videoId),
      ["11charIDzz1", "another_id1"]
    );
  });

  test("returns nothing for html with no video data", () => {
    assert.deepStrictEqual(extractYouTubeVideos("<html><body>no data</body></html>"), []);
  });

  test("isValidVideoId enforces the 11-char id shape", () => {
    assert.strictEqual(isValidVideoId("abcdefghijk"), true);
    assert.strictEqual(isValidVideoId("ab-_ABCDEF1"), true);
    assert.strictEqual(isValidVideoId("short"), false);
    assert.strictEqual(isValidVideoId("waytoolongforanid"), false);
    assert.strictEqual(isValidVideoId("bad chars!!"), false);
  });
});
