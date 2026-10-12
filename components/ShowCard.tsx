"use client";

import { Ticket } from "lucide-react";
import { Avatar } from "./Avatar";
import { Chip, CityChip, ConfidenceChip } from "./Chips";
import { useNow } from "./useNow";
import { isHttpUrl } from "@/lib/normalize";
import { countdownParts, fmtDateTime, fmtDay, fmtTime } from "@/lib/time";
import type { ShowWithArtist } from "@/lib/types";

export type StubModel = {
  heading: string;
  big: string | null;
  sub: string | null;
  tone: "urgent" | "muted";
  pulse: boolean;
  needsCheck: boolean;
};

/** Pure: what the tear-off stub should say right now. */
export function stubModel(
  s: Pick<ShowWithArtist, "early_bird_status" | "early_bird_deadline" | "on_sale_at">,
  now: Date,
): StubModel {
  const dl = s.early_bird_deadline ? new Date(s.early_bird_deadline) : null;
  switch (s.early_bird_status) {
    case "open":
    case "closing_soon": {
      const left = dl ? countdownParts(dl, now) : null;
      if (dl && !left) {
        return {
          heading: "Early bird",
          big: "Ended",
          sub: null,
          tone: "muted",
          pulse: false,
          needsCheck: true,
        };
      }
      return {
        heading: "Early bird",
        big: left ?? "Open",
        sub: dl ? `closes ${fmtDateTime(dl)}` : "no deadline listed",
        tone: "urgent",
        pulse: s.early_bird_status === "closing_soon",
        needsCheck: false,
      };
    }
    case "imminent": {
      const left = dl ? countdownParts(dl, now) : null;
      return {
        heading: left ? "Opens in" : "Early bird",
        big: left ?? "Soon",
        sub: dl ? fmtDateTime(dl) : "date not announced",
        tone: "urgent",
        pulse: false,
        needsCheck: false,
      };
    }
    case "sold_out":
      return {
        heading: "Early bird",
        big: "Sold out",
        sub: null,
        tone: "muted",
        pulse: false,
        needsCheck: false,
      };
    case "not_offered":
      return {
        heading: "General sale",
        big: "No early bird",
        sub: null,
        tone: "muted",
        pulse: false,
        needsCheck: false,
      };
    default:
      return {
        heading: "Ticket tiers",
        big: "Not found yet",
        sub: null,
        tone: "muted",
        pulse: false,
        needsCheck: true,
      };
  }
}

export function ShowCard({
  show,
  onOpen,
  onCheck,
  glow = false,
  checking = false,
}: {
  show: ShowWithArtist;
  onOpen: (id: string, mode?: "going") => void;
  onCheck?: (artistId: string) => void;
  glow?: boolean;
  checking?: boolean;
}) {
  const now = useNow();
  const stub = stubModel(show, now);
  const time = fmtTime(show.start_time);
  const book = isHttpUrl(show.ticket_url) ? show.ticket_url : (show.sources[0]?.url ?? null);
  const venueLine = [show.venue_name, show.venue_name ? null : show.city]
    .filter(Boolean)
    .join(", ");

  return (
    <article className={`stub-card ${glow ? "is-glow" : ""} slide-in`}>
      <div className="relative min-w-0 p-4">
        <div className="flex gap-3">
          <Avatar name={show.artist.name} src={show.artist.image_url} size={56} />
          <div className="min-w-0 flex-1">
            <h3 className="m-0">
              <button
                type="button"
                onClick={() => onOpen(show.id)}
                className="artist-name line-clamp-2 max-w-full text-left text-xl leading-tight after:absolute after:inset-0 after:rounded-[14px] after:content-['']"
                aria-label={`${show.artist.name} in ${show.city}, ${fmtDay(show.start_date)}. Open details`}
              >
                {show.artist.name}
              </button>
            </h3>
            {venueLine && <p className="truncate text-sm text-muted">{venueLine}</p>}
            <p className="text-sm">
              {fmtDay(show.start_date)}
              {time ? `, ${time}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <CityChip show={show} />
              <ConfidenceChip
                confidence={Number(show.confidence)}
                sourceCount={show.sources.length}
              />
              {show.is_sample && <Chip tone="urgent">Sample</Chip>}
            </div>
          </div>
        </div>
        <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
          {show.price_min_inr ? (
            <span className="mr-1 text-sm text-muted">
              From ₹{show.price_min_inr.toLocaleString("en-IN")}
            </span>
          ) : null}
          {book && !show.is_sample ? (
            <a
              href={book}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] bg-stage px-3.5 text-sm font-medium text-stage-ink hover:opacity-90"
            >
              <Ticket className="h-4 w-4" aria-hidden />
              Book tickets
            </a>
          ) : null}
          {!show.is_sample && (
            <button
              type="button"
              onClick={() => onOpen(show.id, "going")}
              className="inline-flex min-h-10 items-center rounded-[10px] border border-line px-3.5 text-sm font-medium hover:bg-raised"
            >
              {show.decision === "going" ? "Going ✓" : "I’m going"}
            </button>
          )}
        </div>
      </div>

      <div
        data-tone={stub.tone}
        className="stub-panel relative flex min-w-0 flex-col justify-center px-3 py-4 text-center"
      >
        <p className="text-xs font-medium uppercase tracking-[0.08em]">{stub.heading}</p>
        <p
          key={stub.pulse ? now.getTime() : "static"}
          suppressHydrationWarning
          aria-live="off"
          className={`stub-big artist-name text-2xl leading-tight ${stub.pulse ? "pulse-minute" : ""}`}
        >
          {stub.big}
        </p>
        {stub.big &&
        stub.heading === "Early bird" &&
        stub.tone === "urgent" &&
        stub.sub?.startsWith("closes") ? (
          <p className="text-xs">left</p>
        ) : null}
        {stub.sub && (
          <p suppressHydrationWarning className="stub-sub mt-1 border-t border-line pt-1 text-xs">
            {stub.sub}
          </p>
        )}
        {stub.needsCheck && onCheck && !show.is_sample && (
          <button
            type="button"
            onClick={() => onCheck(show.artist.id)}
            disabled={checking}
            className="relative z-10 mt-2 min-h-9 rounded-[8px] bg-surface px-2 text-xs font-medium text-ink hover:bg-bg disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check now"}
          </button>
        )}
      </div>
    </article>
  );
}
