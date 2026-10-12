import { describe, expect, it } from "vitest";
import { buildCalendarEvents, templateLink, toGoogleEvent } from "@/lib/calendar-build";
import { buildEmail, buildSubject, safeBookUrl, sortItems } from "@/lib/email/templates";
import { fixtureShow } from "@/lib/fixtures";
import { buildMime, toBase64Url } from "@/lib/integrations/gmail";
import { alertMessage } from "@/lib/email/messages";
import type { ShowWithArtist } from "@/lib/types";

const NOW = new Date("2026-12-01T06:30:00Z"); // 12:00 IST
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function show(over: Partial<ShowWithArtist> & { name?: string } = {}): ShowWithArtist {
  const { name = "Prateek Kuhad", ...rest } = over;
  return fixtureShow({
    name,
    start_date: "2026-12-14",
    start_time: "19:30",
    early_bird_status: "open",
    early_bird_deadline: "2026-12-06T18:29:00.000Z", // Sun 6 Dec 11:59 PM IST
    ticket_url: "https://www.district.in/e/pk",
    ...rest,
  });
}

describe("email subject builder", () => {
  it("home city + early bird open → ticket emoji subject with IST deadline", () => {
    expect(buildSubject([{ show: show(), changeType: "new_show" }], NOW)).toBe(
      "🎟️ Prateek Kuhad in Bengaluru, Mon 14 Dec — early bird open till Sun 6 Dec, 11:59 PM",
    );
  });
  it("home city, no early bird → New:", () => {
    expect(
      buildSubject(
        [
          {
            show: show({ early_bird_status: "not_offered", early_bird_deadline: null }),
            changeType: "new_show",
          },
        ],
        NOW,
      ),
    ).toBe("New: Prateek Kuhad in Bengaluru, Mon 14 Dec");
  });
  it("other city → New: with that city", () => {
    expect(
      buildSubject(
        [
          {
            show: show({
              city: "Mumbai",
              is_home_city: false,
              early_bird_status: "unknown",
              early_bird_deadline: null,
            }),
            changeType: "new_show",
          },
        ],
        NOW,
      ),
    ).toBe("New: Prateek Kuhad in Mumbai, Mon 14 Dec");
  });
  it("appends (+n more) per distinct show and leads with the highest-priority item", () => {
    const home = show();
    const other = show({
      name: "Lauv",
      city: "Delhi NCR",
      is_home_city: false,
      early_bird_status: "unknown",
      early_bird_deadline: null,
    });
    const subj = buildSubject(
      [
        { show: other, changeType: "new_show" },
        { show: home, changeType: "new_show" },
        { show: home, changeType: "early_bird_opened" },
      ],
      NOW,
    );
    expect(subj.startsWith("🎟️ Prateek Kuhad")).toBe(true);
    expect(subj.endsWith("(+1 more)")).toBe(true);
  });
  it("cancelled / date change get their own prefix", () => {
    expect(buildSubject([{ show: show(), changeType: "cancelled" }], NOW)).toMatch(/^Cancelled: /);
    expect(buildSubject([{ show: show(), changeType: "date_changed" }], NOW)).toMatch(/^Update: /);
  });
  it("sorts Act-now first, then home city", () => {
    const act = show({
      name: "A",
      city: "Mumbai",
      is_home_city: false,
      early_bird_deadline: at(10),
    });
    const home = show({ name: "B", early_bird_status: "unknown", early_bird_deadline: null });
    const far = show({
      name: "C",
      city: "Pune",
      is_home_city: false,
      early_bird_status: "unknown",
      early_bird_deadline: null,
    });
    expect(
      sortItems(
        [
          { show: far, changeType: "new_show" },
          { show: home, changeType: "new_show" },
          { show: act, changeType: "new_show" },
        ],
        NOW,
      ).map((i) => i.show.artist.name),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("email body", () => {
  const e = buildEmail([{ show: show({ early_bird_deadline: at(5) }), changeType: "new_show" }], {
    appUrl: "https://radar.example",
    artistCount: 40,
    now: NOW,
  });
  it("includes badge with IST deadline + time left, 3 buttons, footer", () => {
    expect(e.html).toContain("Early bird open until");
    expect(e.html).toContain("about 5 hours left");
    expect(e.html).toContain("Book tickets");
    expect(e.html).toContain("Add to Google Calendar");
    expect(e.html).toContain("https://radar.example/?show=");
    expect(e.html).toContain("watching 40 artists");
    expect(e.text).toContain("Book tickets: https://www.district.in/e/pk");
  });
  it("escapes scraped/AI text", () => {
    const evil = buildEmail(
      [{ show: show({ name: "<script>alert(1)</script>" }), changeType: "new_show" }],
      { appUrl: "https://radar.example", artistCount: 1, now: NOW },
    );
    expect(evil.html).not.toContain("<script>alert(1)");
    expect(evil.html).toContain("&lt;script&gt;");
  });
  it("marks tests clearly", () => {
    const t = buildEmail([{ show: show(), changeType: "new_show" }], {
      appUrl: "https://x.y",
      artistCount: 1,
      now: NOW,
      testBanner: true,
    });
    expect(t.subject.startsWith("[TEST] ")).toBe(true);
    expect(t.html).toContain("This is a test alert");
  });
  it("only links allowlisted ticket URLs, else the first source, else the app", () => {
    expect(safeBookUrl(show({ ticket_url: "https://evil.example/pay" }), "https://a.b")).toBe(
      "https://www.district.in/",
    ); // fixture source
    expect(
      safeBookUrl(show({ ticket_url: "https://evil.example/pay", sources: [] }), "https://a.b"),
    ).toMatch(/^https:\/\/a\.b\/\?show=/);
    expect(safeBookUrl(show({ ticket_url: "https://in.bookmyshow.com/x" }), "https://a.b")).toBe(
      "https://in.bookmyshow.com/x",
    );
  });
});

describe("alert copy", () => {
  it("renders readable one-liners", () => {
    expect(alertMessage("new_show", "Lauv", "Mumbai", "2026-12-14")).toBe(
      "Lauv announced a show in Mumbai, Mon 14 Dec",
    );
  });
});

describe("calendar event builder", () => {
  it("timed concert: 3h, IST, with reminders and source", () => {
    const ev = buildCalendarEvents(show(), "https://radar.example", NOW).concert!;
    expect(ev.allDay).toBe(false);
    expect(ev.summary).toBe("🎵 Prateek Kuhad — Phoenix Marketcity");
    expect(ev.start.toISOString()).toBe("2026-12-14T14:00:00.000Z"); // 19:30 IST
    expect(ev.end.getTime() - ev.start.getTime()).toBe(3 * 3_600_000);
    expect(ev.reminderMinutes).toEqual([1440, 180]);
    const g = toGoogleEvent(ev, "https://radar.example/?show=1") as {
      start: { timeZone: string };
      reminders: { overrides: unknown[] };
      source: { title: string };
    };
    expect(g.start.timeZone).toBe("Asia/Kolkata");
    expect(g.reminders.overrides).toHaveLength(2);
    expect(g.source.title).toBe("Live Show Radar");
  });
  it("unknown start time → all-day event (exclusive end)", () => {
    const ev = buildCalendarEvents(show({ start_time: null }), "https://x.y", NOW).concert!;
    expect(ev.allDay).toBe(true);
    expect(ev.startDate).toBe("2026-12-14");
    expect(ev.endDate).toBe("2026-12-15");
    expect(ev.description).toContain("Start time to be confirmed");
    expect(templateLink(ev)).toContain("dates=20261214%2F20261215");
  });
  it("early-bird deadline event ends at the deadline with 3 reminders; only when known and ahead", () => {
    const ev = buildCalendarEvents(show(), "https://x.y", NOW).early_bird_deadline!;
    expect(ev.end.toISOString()).toBe("2026-12-06T18:29:00.000Z");
    expect(ev.end.getTime() - ev.start.getTime()).toBe(30 * 60_000);
    expect(ev.reminderMinutes).toEqual([1440, 180, 30]);
    expect(
      buildCalendarEvents(show({ early_bird_deadline: null }), "https://x.y", NOW)
        .early_bird_deadline,
    ).toBeUndefined();
    expect(
      buildCalendarEvents(show({ early_bird_deadline: at(-3) }), "https://x.y", NOW)
        .early_bird_deadline,
    ).toBeUndefined();
  });
  it("a deadline minutes away still yields a future event", () => {
    const ev = buildCalendarEvents(
      show({ early_bird_deadline: at(0.2) }),
      "https://x.y",
      NOW,
    ).early_bird_deadline!;
    expect(ev.start.getTime()).toBeGreaterThan(NOW.getTime());
    expect(ev.end.getTime()).toBeGreaterThan(ev.start.getTime());
  });
  it("on-sale event only for a future on_sale_at", () => {
    expect(
      buildCalendarEvents(show({ on_sale_at: at(24) }), "https://x.y", NOW).on_sale!
        .reminderMinutes,
    ).toEqual([60, 10]);
    expect(
      buildCalendarEvents(show({ on_sale_at: at(-1) }), "https://x.y", NOW).on_sale,
    ).toBeUndefined();
  });
  it("decide reminder: 6h before deadline, else tomorrow 10:00 IST", () => {
    const a = buildCalendarEvents(show(), "https://x.y", NOW).decide_reminder!;
    expect(a.start.toISOString()).toBe("2026-12-06T12:29:00.000Z");
    const b = buildCalendarEvents(show({ early_bird_deadline: null }), "https://x.y", NOW, {
      headline: "Go!",
      reasons: ["Fan favourite"],
    }).decide_reminder!;
    expect(b.start.toISOString()).toBe("2026-12-02T04:30:00.000Z");
    expect(b.description).toContain("Go!");
    expect(b.reminderMinutes).toEqual([0]);
  });
  it("template link uses local IST times and ctz", () => {
    const ev = buildCalendarEvents(show(), "https://x.y", NOW).concert!;
    const url = new URL(templateLink(ev));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261214T193000/20261214T223000");
    expect(url.searchParams.get("ctz")).toBe("Asia/Kolkata");
    expect(url.searchParams.get("text")).toContain("Prateek Kuhad");
  });
});

describe("MIME builder", () => {
  const raw = buildMime(
    { from: "me@x.com", to: "you@x.com", subject: "🎟️ New: Äb", html: "<b>hi</b>", text: "hi" },
    "BOUND",
  );
  it("encodes the UTF-8 subject and builds multipart/alternative", () => {
    expect(raw).toContain("Subject: =?UTF-8?B?");
    const b64 = /Subject: =\?UTF-8\?B\?(.*)\?=/.exec(raw)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("🎟️ New: Äb");
    expect(raw).toContain('multipart/alternative; boundary="BOUND"');
    expect(raw).toContain("--BOUND--");
  });
  it("strips header injection and base64url-encodes", () => {
    const evil = buildMime({
      from: "a@x.com",
      to: "b@x.com\r\nBcc: c@x.com",
      subject: "s",
      html: "h",
      text: "t",
    });
    expect(evil).not.toMatch(/\r\nBcc:/);
    expect(toBase64Url("???>>>")).not.toMatch(/[+/=]/);
  });
});
