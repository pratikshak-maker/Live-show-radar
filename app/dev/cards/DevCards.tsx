"use client";

import { ShowCard } from "@/components/ShowCard";
import { ShowCardSkeleton } from "@/components/ShowCardSkeleton";
import type { ShowWithArtist } from "@/lib/types";

export function DevCards({
  items,
}: {
  items: { label: string; show: ShowWithArtist; glow?: boolean }[];
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Ticket-stub card states (dev only)</h1>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <div key={i.label}>
            <p className="mb-1 text-sm text-muted">{i.label}</p>
            <ShowCard show={i.show} glow={i.glow} onOpen={() => {}} onCheck={() => {}} />
          </div>
        ))}
        <div>
          <p className="mb-1 text-sm text-muted">Skeleton</p>
          <ShowCardSkeleton />
        </div>
      </div>
    </div>
  );
}
