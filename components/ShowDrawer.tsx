"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, ExternalLink, MapPin, Ticket, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Chip, CityChip, ConfidenceChip } from "./Chips";
import { stubModel } from "./ShowCard";
import { useToast } from "./ToastProvider";
import { useNow } from "./useNow";
import { alertMessage } from "@/lib/email/messages";
import { domainOf, isHttpUrl } from "@/lib/normalize";
import { confidenceLabel } from "@/lib/scoring";
import { fmtDateTime, fmtDay, fmtTime, relativeAgo } from "@/lib/time";
import type { AiBrief, Decision, ShowWithArtist, Tier } from "@/lib/types";

type Detail = {
  show: ShowWithArtist;
  changes: { id: string; change_type: string; created_at: string }[];
  calendarEvents: { kind: string; html_link: string | null }[];
  googleConnected: boolean;
};

type CalKind = "concert" | "early_bird_deadline" | "on_sale" | "decide_reminder";
const KIND_LABEL: Record<CalKind, string> = {
  concert: "the concert",
  early_bird_deadline: "early-bird deadline",
  on_sale: "tickets go on sale",
  decide_reminder: "decide reminder",
};

const URGENCY: Record<AiBrief["urgency"], { label: string; tone: "urgent" | "stage" | "muted" }> = {
  buy_today: { label: "Buy today", tone: "urgent" },
  this_week: { label: "This week", tone: "stage" },
  no_rush: { label: "No rush", tone: "muted" },
  unclear: { label: "Unclear", tone: "muted" },
};

const TIER_STATUS: Record<
  Tier["status"],
  { label: string; tone: "confirmed" | "muted" | "urgent" }
> = {
  on_sale: { label: "On sale", tone: "confirmed" },
  sold_out: { label: "Sold out", tone: "muted" },
  upcoming: { label: "Opens soon", tone: "urgent" },
  unknown: { label: "Unknown", tone: "muted" },
};

export function ShowDrawer({
  showId,
  seed,
  initialMode,
  onClose,
  onDecision,
}: {
  showId: string | null;
  seed: ShowWithArtist | null;
  initialMode?: "going";
  onClose: () => void;
  onDecision: (id: string, decision: Decision | null) => void;
}) {
  return (
    <Dialog.Root open={Boolean(showId)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet-in fixed inset-y-0 right-0 z-[55] flex w-full flex-col overflow-y-auto bg-raised md:max-w-xl md:rounded-l-[18px] md:border-l md:border-line"
        >
          {showId && (
            <DrawerBody
              key={showId}
              showId={showId}
              seed={seed}
              initialMode={initialMode}
              onClose={onClose}
              onDecision={onDecision}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({
  showId,
  seed,
  initialMode,
  onClose,
  onDecision,
}: {
  showId: string;
  seed: ShowWithArtist | null;
  initialMode?: "going";
  onClose: () => void;
  onDecision: (id: string, decision: Decision | null) => void;
}) {
  const { push } = useToast();
  const now = useNow();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [brief, setBrief] = useState<AiBrief | null | undefined>(undefined);
  const [briefReason, setBriefReason] = useState<string | null>(null);
  const [goingOpen, setGoingOpen] = useState(initialMode === "going");
  const [pick, setPick] = useState({ concert: true, earlyBirdDeadline: true, onSale: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<{ kind: CalKind; url: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/shows/${showId}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (res.ok) setDetail((await res.json()) as Detail);
    } catch {
      /* keep seed */
    }
  }, [showId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shows/${showId}/brief`, { method: "POST" });
        const body = (await res.json()) as { brief?: AiBrief | null; reason?: string };
        if (cancelled) return;
        setBrief(body.brief ?? null);
        setBriefReason(body.reason ?? null);
      } catch {
        if (!cancelled) setBrief(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showId]);

  const show = detail?.show ?? seed;
  if (missing) {
    return (
      <div className="p-6">
        <Dialog.Title className="text-xl font-semibold">
          That show isn&apos;t here anymore
        </Dialog.Title>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-11 rounded-[10px] bg-stage px-4 font-medium text-stage-ink"
        >
          Back to the radar
        </button>
      </div>
    );
  }
  if (!show) {
    return (
      <div className="space-y-3 p-6" aria-busy>
        <Dialog.Title className="sr-only">Loading show</Dialog.Title>
        <div className="skeleton h-16 w-2/3" />
        <div className="skeleton h-28 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  const stub = stubModel(show, now);
  const time = fmtTime(show.start_time);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([show.venue_name, show.city].filter(Boolean).join(", "))}`;
  const book = isHttpUrl(show.ticket_url)
    ? show.ticket_url
    : (show.sources.find((s) => isHttpUrl(s.url))?.url ?? null);
  const existing = new Map(
    (detail?.calendarEvents ?? []).map((e) => [e.kind as CalKind, e.html_link]),
  );
  const hasDeadline = Boolean(
    show.early_bird_deadline && new Date(show.early_bird_deadline).getTime() > now.getTime(),
  );
  const hasOnSale = Boolean(show.on_sale_at && new Date(show.on_sale_at).getTime() > now.getTime());
  const sampleBlock = show.is_sample;

  async function decide(
    decision: Decision,
    calendar?: Record<string, boolean>,
    key = decision as string,
  ) {
    setBusy(key);
    try {
      const res = await fetch(`/api/shows/${showId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, calendar }),
      });
      const body = (await res.json()) as {
        created?: { kind: CalKind; htmlLink: string | null }[];
        templateLinks?: { kind: CalKind; url: string }[];
        error?: { message: string };
      };
      if (!res.ok) {
        push({
          kind: "error",
          title: "That didn't go through",
          description: body.error?.message ?? "Please try again.",
        });
        return;
      }
      onDecision(showId, decision);
      if (decision === "not_interested") {
        push({
          title: "Hidden",
          action: {
            label: "Undo",
            onClick: () => {
              void fetch(`/api/shows/${showId}/decision`, { method: "DELETE" }).then(() =>
                onDecision(showId, null),
              );
            },
          },
        });
        onClose();
        return;
      }
      if (body.created && body.created.length > 0) {
        push({
          title: "Added to calendar",
          links: body.created
            .filter((c) => c.htmlLink && isHttpUrl(c.htmlLink))
            .map((c) => ({ label: `View ${KIND_LABEL[c.kind]}`, href: c.htmlLink as string })),
        });
        setGoingOpen(false);
      }
      if (body.templateLinks && body.templateLinks.length > 0) setLinks(body.templateLinks);
      else if (!(body.created && body.created.length > 0))
        push({ title: decision === "going" ? "Marked as going" : "Saved" });
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function removeEvent(kind: CalKind) {
    await fetch(`/api/shows/${showId}/decision?kind=${kind}`, { method: "DELETE" });
    push({ title: "Removed from calendar" });
    void load();
  }

  return (
    <div className="pb-10">
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-raised p-4">
        <Avatar name={show.artist.name} src={show.artist.image_url} size={64} />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="artist-name truncate text-2xl leading-tight">
            {show.artist.name}
          </Dialog.Title>
          {show.title && <p className="truncate text-sm text-muted">{show.title}</p>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <CityChip show={show} />
            <ConfidenceChip
              confidence={Number(show.confidence)}
              sourceCount={show.sources.length}
            />
            {sampleBlock && <Chip tone="urgent">Sample</Chip>}
            {show.decision === "going" && <Chip tone="confirmed">Going</Chip>}
          </div>
        </div>
        <Dialog.Close
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] hover:bg-surface"
        >
          <X className="h-5 w-5" />
        </Dialog.Close>
      </div>

      <div className="space-y-5 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="font-medium">
            {fmtDay(show.start_date)}
            {time ? `, ${time}` : ""}
          </p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-stage underline underline-offset-2"
          >
            <MapPin className="h-4 w-4" aria-hidden />
            {[show.venue_name, show.city].filter(Boolean).join(", ")} · Open in Maps
          </a>
        </div>

        {/* Early-bird countdown */}
        <section
          aria-label="Early bird"
          className={`rounded-[14px] border p-4 ${stub.tone === "urgent" ? "border-urgent/40 bg-urgent/10" : "border-line bg-surface"}`}
        >
          <p className="text-sm text-muted">{stub.heading}</p>
          <p
            suppressHydrationWarning
            className={`artist-name text-4xl ${stub.tone === "urgent" ? "text-urgent" : "text-muted"}`}
          >
            {stub.big}
            {stub.heading === "Early bird" &&
            stub.tone === "urgent" &&
            stub.sub?.startsWith("closes") ? (
              <span className="ml-2 text-base font-normal text-muted">left</span>
            ) : null}
          </p>
          {show.early_bird_deadline && stub.tone === "urgent" && (
            <p className="mt-1 text-sm">
              {show.early_bird_status === "imminent" ? "Opens" : "Closes"}{" "}
              {fmtDateTime(show.early_bird_deadline)} IST
            </p>
          )}
          {stub.needsCheck && (
            <p className="mt-1 text-sm text-muted">
              We haven&apos;t found ticket tiers yet. The next check will try again.
            </p>
          )}
        </section>

        {/* AI brief */}
        <section
          aria-label="Should I go?"
          className="rounded-[14px] border border-line bg-surface p-4"
        >
          <h3 className="text-base font-semibold">Should I go?</h3>
          {brief === undefined ? (
            <div className="mt-2 space-y-2" aria-busy>
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-5/6" />
            </div>
          ) : brief ? (
            <div className="mt-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {brief.headline}
                <Chip tone={URGENCY[brief.urgency].tone}>{URGENCY[brief.urgency].label}</Chip>
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {brief.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {brief.travel_note && <p className="mt-2 text-sm text-muted">{brief.travel_note}</p>}
              {brief.caveat && <p className="mt-2 text-sm text-urgent">{brief.caveat}</p>}
              <p className="mt-2 text-xs text-muted">Powered by Gemini</p>
            </div>
          ) : briefReason === "not_configured" ? (
            <p className="mt-1 text-sm text-muted">Connect Gemini to get a quick recommendation.</p>
          ) : briefReason === "sample" ? (
            <p className="mt-1 text-sm text-muted">Recommendations appear for real shows.</p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              The recommendation isn&apos;t available right now.
            </p>
          )}
        </section>

        {/* Actions */}
        {!sampleBlock && (
          <section aria-label="Actions" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {book && (
                <a
                  href={book}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[10px] bg-stage px-5 font-medium text-stage-ink hover:opacity-90"
                >
                  <Ticket className="h-5 w-5" aria-hidden />
                  Book tickets
                </a>
              )}
              <button
                type="button"
                onClick={() => setGoingOpen((o) => !o)}
                aria-expanded={goingOpen}
                className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-line px-5 font-medium hover:bg-surface"
              >
                {show.decision === "going" ? "Going ✓" : "I’m going"}
              </button>
              <button
                type="button"
                disabled={busy === "maybe"}
                onClick={() => void decide("maybe", { decideReminder: true }, "maybe")}
                className="inline-flex min-h-12 items-center justify-center rounded-[10px] px-3 text-sm font-medium text-muted hover:bg-surface disabled:opacity-60"
              >
                {busy === "maybe" ? "Saving…" : "Remind me to decide"}
              </button>
            </div>

            {goingOpen && (
              <div className="rounded-[14px] border border-line bg-surface p-4">
                <p className="text-sm font-medium">Add to your calendar</p>
                <div className="mt-2 space-y-1">
                  <Check
                    checked={pick.concert}
                    onChange={(v) => setPick({ ...pick, concert: v })}
                    label="Add the concert to my calendar"
                  />
                  {hasDeadline && (
                    <Check
                      checked={pick.earlyBirdDeadline}
                      onChange={(v) => setPick({ ...pick, earlyBirdDeadline: v })}
                      label="Remind me before early bird closes"
                    />
                  )}
                  {hasOnSale && (
                    <Check
                      checked={pick.onSale}
                      onChange={(v) => setPick({ ...pick, onSale: v })}
                      label="Remind me when tickets go on sale"
                    />
                  )}
                </div>
                {existing.size > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {[...existing.entries()].map(([kind, link]) => (
                      <li key={kind} className="flex items-center gap-2 text-confirmed">
                        On your calendar: {KIND_LABEL[kind]}
                        {link && isHttpUrl(link) && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stage underline underline-offset-2"
                          >
                            View
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeEvent(kind)}
                          className="text-muted underline underline-offset-2"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  disabled={busy === "going"}
                  onClick={() =>
                    void decide(
                      "going",
                      {
                        concert: pick.concert,
                        earlyBirdDeadline: hasDeadline && pick.earlyBirdDeadline,
                        onSale: hasOnSale && pick.onSale,
                      },
                      "going",
                    )
                  }
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-stage font-medium text-stage-ink disabled:opacity-60"
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden />
                  {busy === "going" ? "Adding…" : "Add to calendar"}
                </button>
                {detail && !detail.googleConnected && (
                  <p className="mt-2 text-xs text-muted">
                    No Google connection needed — you&apos;ll get one-click links.{" "}
                    <Link href="/settings" className="text-stage underline underline-offset-2">
                      Connect Google to do this in one tap
                    </Link>
                  </p>
                )}
              </div>
            )}

            {links.length > 0 && (
              <div className="rounded-[14px] border border-line bg-surface p-4">
                <p className="text-sm font-medium">Open each in Google Calendar</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {links.map((l) => (
                    <a
                      key={l.kind}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line px-3 text-sm hover:bg-raised"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      Add {KIND_LABEL[l.kind]}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busy === "not_interested"}
              onClick={() => void decide("not_interested")}
              className="min-h-10 text-sm text-muted underline underline-offset-2"
            >
              Not interested
            </button>
          </section>
        )}

        {/* Tiers */}
        {show.tiers.length > 0 && (
          <section aria-label="Ticket tiers">
            <h3 className="text-base font-semibold">Ticket tiers</h3>
            <div className="mt-2 overflow-x-auto rounded-[12px] border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {show.tiers.map((t) => (
                    <tr key={t.name} className="border-t border-line">
                      <td className="px-3 py-2">
                        {t.name}
                        {t.is_early_bird && (
                          <span className="ml-1.5 text-xs text-urgent">early bird</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {t.price_inr ? `₹${t.price_inr.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={TIER_STATUS[t.status].tone}>{TIER_STATUS[t.status].label}</Chip>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {t.sale_start ? fmtDateTime(t.sale_start) : "—"}
                        {t.sale_end ? ` → ${fmtDateTime(t.sale_end)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Sources */}
        {show.sources.length > 0 && (
          <section aria-label="Sources">
            <h3 className="text-base font-semibold">Sources</h3>
            <p className="text-sm text-muted">
              {confidenceLabel(Number(show.confidence))}
              {" — "}
              {new Set(show.sources.map((s) => domainOf(s.url))).size} source
              {new Set(show.sources.map((s) => domainOf(s.url))).size === 1 ? "" : "s"} checked.
            </p>
            <ul className="mt-2 space-y-1">
              {show.sources
                .filter((s) => isHttpUrl(s.url))
                .map((s) => (
                  <li key={s.url} className="flex flex-wrap items-center gap-2 text-sm">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-stage underline underline-offset-2"
                    >
                      {domainOf(s.url) ?? s.url}
                    </a>
                    <span className="text-muted">fetched {relativeAgo(s.fetched_at)}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {/* History */}
        {detail && detail.changes.length > 0 && (
          <section aria-label="History">
            <h3 className="text-base font-semibold">What changed</h3>
            <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
              {detail.changes.map((c) => (
                <li key={c.id} className="text-sm">
                  {alertMessage(c.change_type, show.artist.name, show.city, show.start_date)}
                  <span className="ml-2 text-muted">{relativeAgo(c.created_at)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-10 items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--stage)]"
      />
      {label}
    </label>
  );
}
