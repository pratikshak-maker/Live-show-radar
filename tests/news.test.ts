import { describe, expect, it } from "vitest";
import { parseNewsRss, unwrapBingLink } from "@/lib/integrations/news";
import { splitPageNotes } from "@/lib/integrations/gemini";

const RSS = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel>
<item><title>Lollapalooza India 2027 lineup: Anuv Jain and more</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;url=https%3a%2f%2fwww.outlookindia.com%2fart%2flolla-2027&amp;c=1&amp;mkt=en-in</link>
<description>The festival returns to Mahalaxmi Racecourse, Mumbai on January 23 and 24.</description>
<pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>No link item</title><link>not a url</link><description>x</description></item>
</channel></rss>`;

describe("news search parsing", () => {
  it("unwraps Bing redirect links to the real article", () => {
    expect(
      unwrapBingLink(
        "http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fexample.com%2fa&c=1",
      ),
    ).toBe("https://example.com/a");
    expect(unwrapBingLink("https://example.com/direct")).toBe("https://example.com/direct");
  });
  it("parses items with the real URL, snippet, date and domain; drops junk", () => {
    const items = parseNewsRss(RSS);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: "https://www.outlookindia.com/art/lolla-2027",
      domain: "outlookindia.com",
      publishedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(items[0].snippet).toContain("Mahalaxmi Racecourse");
  });
});

describe("page-notes splitting", () => {
  const urls = ["https://a.com/1", "https://b.com/2", "https://c.com/3"];
  it("maps '### url' sections to their URL and skips 'Nothing relevant'", () => {
    const text = `### https://a.com/1\nMumbai, 23 Jan 2027, Mahalaxmi Racecourse.\n\n### <https://b.com/2>\nNothing relevant.\n\n## https://c.com/3\nTickets on district.in from ₹4,999.`;
    const m = splitPageNotes(text, urls);
    expect(m.get("https://a.com/1")).toContain("Mahalaxmi");
    expect(m.has("https://b.com/2")).toBe(false);
    expect(m.get("https://c.com/3")).toContain("district.in");
  });
  it("ignores sections for URLs it wasn't given", () => {
    expect(splitPageNotes("### https://evil.com\nfake show", urls).size).toBe(0);
  });
});
