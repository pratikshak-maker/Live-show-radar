import { describe, expect, it } from "vitest";
import { layoutBlips } from "@/components/RadarHero";
import { isPlaceholder } from "@/lib/integrations/deezer";
import { fixtureShow } from "@/lib/fixtures";

const artist = (
  id: string,
  over: Partial<{ image_url: string | null; is_favorite: boolean }> = {},
) => ({
  id,
  name: `Artist ${id}`,
  image_url: `https://cdn-images.dzcdn.net/images/artist/${id}/500x500.jpg`,
  is_favorite: false,
  show_count: 0,
  ...over,
});

describe("radar blip layout", () => {
  const show = fixtureShow({ name: "Artist b" });
  show.artist.id = "b";

  it("puts artists with shows first, closer to the centre, linked to their show", () => {
    const blips = layoutBlips(
      [artist("a"), artist("b"), artist("c", { is_favorite: true })],
      [show],
    );
    expect(blips[0]).toMatchObject({ id: "b", hot: true, showId: show.id });
    expect(blips[1].id).toBe("c"); // favourite next
    const dist = (b: { x: number; y: number }) => Math.hypot(b.x - 50, b.y - 50);
    expect(dist(blips[0])).toBeLessThan(dist(blips[1]));
  });

  it("keeps every blip inside the radar and caps the count", () => {
    const many = Array.from({ length: 30 }, (_, i) => artist(String(i)));
    const blips = layoutBlips(many, [], 11);
    expect(blips).toHaveLength(11);
    for (const b of blips) {
      expect(b.x).toBeGreaterThan(5);
      expect(b.x).toBeLessThan(95);
      expect(b.y).toBeGreaterThan(5);
      expect(b.y).toBeLessThan(95);
    }
  });

  it("skips artists with neither a photo nor a show", () => {
    expect(layoutBlips([artist("x", { image_url: null })], [])).toEqual([]);
  });
});

describe("deezer placeholder detection", () => {
  it("rejects the generic silhouette and accepts real photos", () => {
    expect(
      isPlaceholder("https://e-cdns-images.dzcdn.net/images/artist//500x500-000000-80-0-0.jpg"),
    ).toBe(true);
    expect(
      isPlaceholder(
        "https://cdn-images.dzcdn.net/images/artist/eb0c0e91/500x500-000000-80-0-0.jpg",
      ),
    ).toBe(false);
  });
});

import { classifyGeminiError } from "@/lib/integrations/gemini";

describe("Gemini error classification", () => {
  const err = (code: number, message: string) =>
    new Error(JSON.stringify({ error: { code, message } }));
  it("treats 503 high demand as overloaded (retry on the fallback model)", () => {
    expect(
      classifyGeminiError(err(503, "This model is currently experiencing high demand.")).kind,
    ).toBe("overloaded");
  });
  it("treats a 429 with no retry hint + 'plan and billing' as a plan quota (don't retry)", () => {
    expect(
      classifyGeminiError(
        err(
          429,
          "RESOURCE_EXHAUSTED You exceeded your current quota, please check your plan and billing details.",
        ),
      ).kind,
    ).toBe("plan_quota");
  });
  it("keeps per-minute 429s with a retry delay as rate limits", () => {
    const c = classifyGeminiError(
      err(429, 'RESOURCE_EXHAUSTED check your plan and billing "retryDelay": "21s"'),
    );
    expect(c).toEqual({ kind: "rate_limited", retryMs: 21000 });
  });
  it("detects daily quotas", () => {
    expect(
      classifyGeminiError(err(429, "RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel"))
        .kind,
    ).toBe("daily_quota");
  });
});
