"use client";

import dynamic from "next/dynamic";
import { List, Map as MapIcon, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AskBox } from "./AskBox";
import { RadarHero, type HeroArtist } from "./RadarHero";
import { SCAN_DONE_EVENT, useScan } from "./ScanProvider";
import { ShowCard } from "./ShowCard";
import { ShowCardSkeleton } from "./ShowCardSkeleton";
import { ShowDrawer } from "./ShowDrawer";
import { useNow } from "./useNow";
import { groupIntoLanes } from "@/lib/lanes";
import type { Decision, ShowWithArtist } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-[60vh] min-h-[360px] w-full" aria-busy />,
});

export function RadarView({
  initialShows,
  artists,
  homeCity,
  hasSamples,
}: {
  initialShows: ShowWithArtist[];
  artists: HeroArtist[];
  homeCity: string;
  hasSamples: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const { startScan, running, scanningArtistId } = useScan();
  const [shows, setShows] = useState(initialShows);
  const [view, setView] = useState<"list" | "map">("list");
  const [city, setCity] = useState("All");
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [prevInitial, setPrevInitial] = useState(initialShows);
  const [drawerMode, setDrawerMode] = useState<"going" | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  // Server re-render (router.refresh after a scan) hands us fresh data.
  if (prevInitial !== initialShows) {
    setPrevInitial(initialShows);
    setShows(initialShows);
  }

  const openId = params.get("show");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/shows?includeHidden=1", { cache: "no-store" });
      if (res.ok) setShows(((await res.json()) as { shows: ShowWithArtist[] }).shows);
    } catch {
      /* keep what we have */
    }
  }, []);

  // Revalidate every 60 s and right after a scan completes.
  useEffect(() => {
    const first = setTimeout(async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    }, 0);
    const t = setInterval(refresh, 60_000);
    window.addEventListener(SCAN_DONE_EVENT, refresh);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener(SCAN_DONE_EVENT, refresh);
    };
  }, [refresh]);

  const setOpen = useCallback(
    (id: string | null, mode?: "going") => {
      setDrawerMode(mode);
      const next = new URLSearchParams(params.toString());
      if (id) next.set("show", id);
      else next.delete("show");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const cities = useMemo(() => ["All", ...[...new Set(shows.map((s) => s.city))].sort()], [shows]);

  const hiddenCount = shows.filter((s) => s.decision === "not_interested").length;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return shows.filter((s) => {
      const hidden = s.decision === "not_interested";
      if (showHidden ? !hidden : hidden) return false;
      if (city !== "All" && s.city !== city) return false;
      if (
        needle &&
        !s.artist.name.toLowerCase().includes(needle) &&
        !(s.venue_name ?? "").toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [shows, city, q, showHidden]);

  const lanes = useMemo(() => groupIntoLanes(filtered, now), [filtered, now]);
  const seed = openId ? (shows.find((s) => s.id === openId) ?? null) : null;

  function onDecision(id: string, decision: Decision | null) {
    setShows((prev) => prev.map((s) => (s.id === id ? { ...s, decision } : s)));
    void refresh();
  }

  const checkArtist = (artistId: string) => void startScan(artistId);
  const laneProps = { onOpen: setOpen, onCheck: checkArtist, running, scanningArtistId };

  return (
    <div className="space-y-4">
      <RadarHero
        artists={artists}
        shows={shows.filter((s) => s.decision !== "not_interested")}
        actNow={lanes.act_now.length}
        onOpen={(id) => setOpen(id)}
      />
      {hasSamples && shows.some((s) => s.is_sample) && (
        <p className="rounded-[12px] border border-sky bg-sky/20 px-4 py-2.5 text-sm">
          These are examples. Real shows appear after the first scan.
        </p>
      )}

      <AskBox onOpen={(id) => setOpen(id)} />

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex rounded-[10px] bg-surface p-1">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-sm font-medium ${view === v ? "bg-raised text-ink" : "text-muted"}`}
            >
              {v === "list" ? (
                <List className="h-4 w-4" aria-hidden />
              ) : (
                <MapIcon className="h-4 w-4" aria-hidden />
              )}
              {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="sr-only">City</span>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="min-h-11 rounded-[10px] border border-line bg-surface px-3 text-sm"
          >
            {cities.map((c) => (
              <option key={c} value={c}>
                {c === "All" ? "City: All" : c}
              </option>
            ))}
          </select>
        </label>
        <label className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search artist</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search artist…"
            className="min-h-11 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted"
          />
        </label>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((h) => !h)}
            aria-pressed={showHidden}
            className={`min-h-11 rounded-[10px] px-3 text-sm ${showHidden ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
          >
            Hidden ({hiddenCount})
          </button>
        )}
      </div>

      {loading && shows.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <ShowCardSkeleton key={i} />
          ))}
        </div>
      ) : shows.filter((s) => s.decision !== "not_interested").length === 0 && !showHidden ? (
        <EmptyRadar />
      ) : view === "map" ? (
        <MapWithGeocode shows={filtered} onOpen={(id) => setOpen(id)} onGeocoded={refresh} />
      ) : showHidden ? (
        <Lane title="Hidden" items={filtered} {...laneProps} />
      ) : (
        <div className="space-y-8">
          <Lane
            title="Act now"
            items={lanes.act_now}
            glow
            empty="Nothing urgent right now. You'll get an email the moment that changes."
            {...laneProps}
          />
          <Lane
            title={`Coming to ${homeCity}`}
            items={lanes.home}
            empty={`No shows announced in ${homeCity} yet.`}
            {...laneProps}
          />
          <Lane
            title="Elsewhere in India"
            items={lanes.elsewhere}
            empty="No shows in other cities right now."
            {...laneProps}
          />
        </div>
      )}

      <ShowDrawer
        showId={openId}
        seed={seed}
        initialMode={drawerMode}
        onClose={() => setOpen(null)}
        onDecision={onDecision}
      />
    </div>
  );
}

function EmptyRadar() {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-8 text-center">
      <p className="artist-name text-2xl">All quiet on the radar</p>
      <p className="mx-auto mt-2 max-w-[60ch] text-muted">
        No India shows announced for your artists right now. The radar checks every 30 minutes and
        emails you the moment one appears.
      </p>
    </div>
  );
}

function Lane({
  title,
  items,
  glow = false,
  empty,
  onOpen,
  onCheck,
  running,
  scanningArtistId,
}: {
  title: string;
  items: ShowWithArtist[];
  glow?: boolean;
  empty?: string;
  onOpen: (id: string, mode?: "going") => void;
  onCheck: (artistId: string) => void;
  running: boolean;
  scanningArtistId: string | null;
}) {
  const id = `lane-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {title}{" "}
        <span key={items.length} className="count-in text-base font-normal text-muted">
          ({items.length})
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty ?? "Nothing here."}</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {items.map((s, i) => (
            <li key={s.id} className="stagger" style={{ "--i": i } as React.CSSProperties}>
              <ShowCard
                show={s}
                glow={glow}
                onOpen={onOpen}
                onCheck={onCheck}
                checking={running && scanningArtistId === s.artist.id}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MapWithGeocode({
  shows,
  onOpen,
  onGeocoded,
}: {
  shows: ShowWithArtist[];
  onOpen: (id: string) => void;
  onGeocoded: () => void;
}) {
  // First map view: lazily geocode a few venues (server-side 1 req/s throttle), then refresh pins.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 3 && alive; i++) {
        const r = await fetch("/api/venues/geocode", { method: "POST" })
          .then((x) => x.json() as Promise<{ done: number; remaining: number }>)
          .catch(() => null);
        if (!r || r.done === 0) break;
        onGeocoded();
        if (r.remaining === 0) break;
      }
    })();
    return () => {
      alive = false;
    };
  }, [onGeocoded]);
  return <MapView shows={shows} onOpen={onOpen} />;
}
