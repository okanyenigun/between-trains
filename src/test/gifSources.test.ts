import * as assert from "assert";
import {
  extractGiphyGifUrls,
  extractTenorGifUrls,
  isAllowedGifUrl,
} from "../memes/gifSources";

suite("gif sources", () => {
  test("extracts tenor media urls from html", () => {
    const html = `
      <img src="https://media.tenor.com/AbC123xyz_-/funny-cat.gif" alt="x">
      <img src="https://media1.tenor.com/Qw9_z/dev-meme.gif">
      "url":"https://media.tenor.com/AbC123xyz_-/funny-cat.gif"
      <img src="https://media.tenor.com/whatever/preview.png">
    `;
    const urls = extractTenorGifUrls(html);
    assert.deepStrictEqual(urls, [
      "https://media.tenor.com/AbC123xyz_-/funny-cat.gif",
      "https://media1.tenor.com/Qw9_z/dev-meme.gif",
    ]);
  });

  test("extracts giphy media urls from html", () => {
    const html = `
      <img srcset="https://media0.giphy.com/media/abcDEF123/giphy.gif 480w">
      "https://media2.giphy.com/media/v1.Y2lkPTc5/xyz789/200.gif"
      "https://media2.giphy.com/media/v1.Y2lkPTc5/xyz789/200.gif"
      <img src="https://media.giphy.com/media/qqq111/giphy.webp">
    `;
    const urls = extractGiphyGifUrls(html);
    assert.deepStrictEqual(urls, [
      "https://media0.giphy.com/media/abcDEF123/giphy.gif",
      "https://media2.giphy.com/media/v1.Y2lkPTc5/xyz789/200.gif",
    ]);
  });

  test("allowlist accepts only https tenor/giphy media hosts", () => {
    assert.strictEqual(isAllowedGifUrl("https://media.tenor.com/a/b.gif"), true);
    assert.strictEqual(isAllowedGifUrl("https://media3.giphy.com/media/x/giphy.gif"), true);
    assert.strictEqual(isAllowedGifUrl("http://media.tenor.com/a/b.gif"), false, "http rejected");
    assert.strictEqual(isAllowedGifUrl("https://evil.com/media.tenor.com/a.gif"), false);
    assert.strictEqual(isAllowedGifUrl("https://media.tenor.com.evil.com/a.gif"), false);
    assert.strictEqual(isAllowedGifUrl("not a url"), false);
    assert.strictEqual(isAllowedGifUrl("https://giphy.com/anything.gif"), false, "page host is not a media host");
  });
});
