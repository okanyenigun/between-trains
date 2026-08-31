import * as assert from "assert";
import { normalizeTavily, normalizeBrave, normalizeSerper } from "../news/searchProviders";

suite("news search normalizers", () => {
  test("normalizeTavily maps results, derives source host, drops incomplete rows", () => {
    const results = normalizeTavily({
      results: [
        {
          title: "  Chip breakthrough  ",
          url: "https://www.example.com/a?ref=1",
          content: "  A new node ships.  ",
          published_date: "2026-07-20",
        },
        { title: "No url", url: "" }, // dropped (no url)
        { url: "https://example.org/x" }, // dropped (no title)
      ],
    });
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual(results[0], {
      title: "Chip breakthrough",
      url: "https://www.example.com/a?ref=1",
      source: "example.com",
      snippet: "A new node ships.",
      publishedAt: "2026-07-20",
    });
  });

  test("normalizeBrave prefers meta_url.hostname and falls back to age fields", () => {
    const results = normalizeBrave({
      results: [
        {
          title: "Markets rally",
          url: "https://news.site/story",
          description: "Stocks up.",
          meta_url: { hostname: "news.site" },
          age: "2 hours ago",
        },
        {
          title: "No meta host",
          url: "https://www.other.com/b",
          description: "x",
          page_age: "2026-07-19",
        },
      ],
    });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].source, "news.site");
    assert.strictEqual(results[0].publishedAt, "2 hours ago");
    assert.strictEqual(results[1].source, "other.com");
    assert.strictEqual(results[1].publishedAt, "2026-07-19");
  });

  test("normalizeSerper reads the news[] array and source field", () => {
    const results = normalizeSerper({
      news: [
        {
          title: "New telescope image",
          link: "https://space.example/img",
          snippet: "Deep field.",
          source: "Space Example",
          date: "1 day ago",
        },
        { title: "bad", link: "" }, // dropped
      ],
    });
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual(results[0], {
      title: "New telescope image",
      url: "https://space.example/img",
      source: "Space Example",
      snippet: "Deep field.",
      publishedAt: "1 day ago",
    });
  });

  test("all normalizers return [] for malformed payloads", () => {
    assert.deepStrictEqual(normalizeTavily(null), []);
    assert.deepStrictEqual(normalizeTavily({ results: "nope" }), []);
    assert.deepStrictEqual(normalizeBrave({}), []);
    assert.deepStrictEqual(normalizeSerper({ news: null }), []);
  });
});
