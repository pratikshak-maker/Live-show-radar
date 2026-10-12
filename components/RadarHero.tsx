"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { ScanButton } from "./ScanButton";
import { useScan } from "./ScanProvider";
import type { ShowWithArtist } from "@/lib/types";

export type HeroArtist = {
  id: string;
  name: string;
  image_url: string | null;
  is_favorite: boolean;
  show_count: number;
};

type Blip = HeroArtist & { x: number; y: number; showId: string | null; hot: boolean };

const GOLDEN = 137.508; // degrees — spreads blips evenly without collisions

/** Pure layout: artists with shows sit closer to the centre ("detected"), others on the outer rings. */
export function layoutBlips(artists: HeroArtist[], shows: ShowWithArtist[], max = 11): Blip[] {
  const firstShow = new Map<string, string>();
  for (const s of shows) if (!firstShow.has(s.artist.id)) firstShow.set(s.artist.id, s.id);
  const ranked = [...artists]
    .filter((a) => a.image_url || firstShow.has(a.id))
    .sort(
      (a, b) =>
        Number(firstShow.has(b.id)) - Number(firstShow.has(a.id)) ||
        Number(b.is_favorite) - Number(a.is_favorite) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, max);
  return ranked.map((a, i) => {
    const hot = firstShow.has(a.id);
    const radius = hot ? 20 + (i % 2) * 8 : 32 + (i % 3) * 6; // % of the radar's size
    const angle = ((i * GOLDEN + 20) * Math.PI) / 180;
    return {
      ...a,
      hot,
      showId: firstShow.get(a.id) ?? null,
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    };
  });
}

export function RadarHero({
  artists,
  shows,
  actNow,
  onOpen,
}: {
  artists: HeroArtist[];
  shows: ShowWithArtist[];
  actNow: number;
  onOpen: (id: string) => void;
}) {
  const { running } = useScan();
  const [focus, setFocus] = useState<string | null>(null);
  const blips = useMemo(() => layoutBlips(artists, shows), [artists, shows]);
  const realShows = shows.filter((s) => !s.is_sample).length;
  const focused = blips.find((b) => b.id === focus) ?? null;

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden rounded-[14px] border border-line bg-surface"
    >
      {/* soft cobalt→sky wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--sky) 28%, transparent), transparent 60%), radial-gradient(90% 80% at 0% 100%, color-mix(in srgb, var(--cobalt) 12%, transparent), transparent 60%)",
        }}
      />
      <div className="relative grid items-center gap-6 p-5 md:grid-cols-[1fr_auto] md:p-7">
        <div className="slide-in">
          <h1 id="hero-title" className="text-3xl font-semibold leading-tight md:text-4xl">
            Your artists,
            <br />
            on the radar.
          </h1>
          <p className="mt-2 max-w-[46ch] text-muted">
            We watch {artists.length} artists for shows anywhere in India and tell you the moment
            tickets drop — early birds first.
          </p>
          <dl className="mt-4 flex flex-wrap gap-2">
            {[
              { k: "Artists watched", v: artists.length },
              { k: "Shows in India", v: realShows },
              { k: "Act now", v: actNow },
            ].map((s, i) => (
              <div
                key={s.k}
                className="stagger rounded-[10px] border border-line bg-bg/70 px-3.5 py-2"
                style={{ "--i": i + 2 } as React.CSSProperties}
              >
                <dt className="text-xs text-muted">{s.k}</dt>
                <dd key={s.v} className="count-in artist-name text-2xl text-stage">
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <ScanButton />
            <Link
              href="/artists"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-4 font-medium hover:bg-raised"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add artists
            </Link>
          </div>
        </div>

        {/* The radar graphic */}
        <div className="relative mx-auto aspect-square w-[min(78vw,320px)]">
          <div
            className="absolute inset-0 rounded-full border border-line"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--sky) 16%, transparent), transparent 70%)",
            }}
          />
          {[0.72, 0.46, 0.2].map((r) => (
            <div
              key={r}
              aria-hidden
              className="absolute rounded-full border border-line"
              style={{ inset: `${((1 - r) / 2) * 100}%` }}
            />
          ))}
          <div
            aria-hidden
            className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line"
          />
          <div
            aria-hidden
            className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-line"
          />
          <div
            aria-hidden
            className="radar-beam absolute inset-0 rounded-full"
            style={{ animationDuration: running ? "1.3s" : "4.5s" }}
          />
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stage"
          />

          <ul aria-label="Artists on the radar">
            {blips.map((b, i) => {
              const size = b.hot ? 46 : 36;
              const label = b.hot
                ? `${b.name} — has a show. Open it`
                : `${b.name} — no India show yet`;
              const inner = (
                <Avatar
                  name={b.name}
                  src={b.image_url}
                  size={size}
                  rounded="rounded-full"
                  className={b.hot ? "ring-2 ring-[var(--sky)]" : "opacity-80 grayscale-[35%]"}
                />
              );
              return (
                <li
                  key={b.id}
                  className="blip-enter absolute"
                  style={{ left: `${b.x}%`, top: `${b.y}%`, "--i": i } as React.CSSProperties}
                >
                  {b.showId ? (
                    <button
                      type="button"
                      aria-label={label}
                      onClick={() => onOpen(b.showId as string)}
                      onMouseEnter={() => setFocus(b.id)}
                      onMouseLeave={() => setFocus(null)}
                      onFocus={() => setFocus(b.id)}
                      onBlur={() => setFocus(null)}
                      className="radar-blip block rounded-full transition-transform hover:scale-125 focus-visible:scale-125"
                      style={{ "--i": i } as React.CSSProperties}
                    >
                      {inner}
                    </button>
                  ) : (
                    <Link
                      href="/artists"
                      aria-label={label}
                      onMouseEnter={() => setFocus(b.id)}
                      onMouseLeave={() => setFocus(null)}
                      onFocus={() => setFocus(b.id)}
                      onBlur={() => setFocus(null)}
                      className="block rounded-full transition-transform hover:scale-125 focus-visible:scale-125"
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Name tag for the hovered blip */}
          <div
            aria-hidden
            className={`pointer-events-none absolute left-1/2 top-[calc(100%+6px)] -translate-x-1/2 whitespace-nowrap rounded-full bg-stage px-3 py-1 text-xs font-medium text-stage-ink transition-all duration-200 ${
              focused ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
            }`}
          >
            {focused ? `${focused.name}${focused.hot ? " · show found" : ""}` : " "}
          </div>
        </div>
      </div>
    </section>
  );
}
