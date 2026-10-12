"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { resolveCity } from "@/lib/normalize";
import { laneFor } from "@/lib/scoring";
import { fmtDay } from "@/lib/time";
import type { Lane, ShowWithArtist } from "@/lib/types";

type Pin = { show: ShowWithArtist; lat: number; lng: number; lane: Lane };

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function Fit({ pins }: { pins: Pin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) {
      map.setView([22.5, 79], 4.6);
      return;
    }
    const b = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(b, { padding: [40, 40], maxZoom: 9 });
  }, [pins, map]);
  return null;
}

export default function MapView({
  shows,
  onOpen,
}: {
  shows: ShowWithArtist[];
  onOpen: (id: string) => void;
}) {
  const colors = useMemo(
    () => ({
      act_now: cssVar("--cobalt", "#0047ab"),
      home: cssVar("--sky", "#82c8e5"),
      elsewhere: cssVar("--slate", "#6d8196"),
    }),
    [],
  );
  const pins = useMemo<Pin[]>(() => {
    const now = new Date();
    return shows.flatMap((s) => {
      const c = resolveCity(s.city);
      const lat = s.lat ?? c?.lat;
      const lng = s.lng ?? c?.lng;
      if (lat == null || lng == null) return [];
      return [{ show: s, lat, lng, lane: laneFor(s, now) }];
    });
  }, [shows]);

  return (
    <div
      className="h-[60vh] min-h-[360px] overflow-hidden rounded-[14px] border border-line"
      role="region"
      aria-label="Map of upcoming shows"
    >
      <MapContainer center={[22.5, 79]} zoom={5} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit pins={pins} />
        {pins.map((p) => (
          <CircleMarker
            key={p.show.id}
            center={[p.lat, p.lng]}
            radius={10}
            pathOptions={{
              color: colors[p.lane],
              fillColor: colors[p.lane],
              fillOpacity: 0.75,
              weight: 2,
            }}
          >
            <Popup>
              <div className="min-w-[160px]">
                <p className="artist-name text-base">{p.show.artist.name}</p>
                <p className="text-sm">
                  {p.show.venue_name ? `${p.show.venue_name}, ` : ""}
                  {p.show.city}
                </p>
                <p className="text-sm">{fmtDay(p.show.start_date)}</p>
                <button
                  type="button"
                  onClick={() => onOpen(p.show.id)}
                  className="mt-2 min-h-9 rounded-[10px] bg-stage px-3 text-sm font-medium text-stage-ink"
                >
                  Open
                </button>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
