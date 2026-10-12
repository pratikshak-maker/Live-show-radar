"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { BadgeCheck, CircleHelp, MapPin, ShieldQuestion } from "lucide-react";
import { confidenceLabel } from "@/lib/scoring";
import type { ShowWithArtist } from "@/lib/types";

export function Chip({
  children,
  tone = "muted",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "muted" | "stage" | "urgent" | "confirmed";
  className?: string;
}) {
  const tones = {
    muted: "bg-raised text-muted",
    stage: "bg-stage/15 text-stage",
    urgent: "bg-urgent/15 text-urgent",
    confirmed: "bg-confirmed/15 text-confirmed",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function CityChip({ show }: { show: Pick<ShowWithArtist, "city" | "is_home_city"> }) {
  return show.is_home_city ? (
    <Chip tone="stage">
      <MapPin className="h-3 w-3" aria-hidden />
      {show.city}
    </Chip>
  ) : (
    <Chip>{show.city}</Chip>
  );
}

export function ConfidenceChip({
  confidence,
  sourceCount = 0,
}: {
  confidence: number;
  sourceCount?: number;
}) {
  const label = confidenceLabel(confidence);
  if (label === "Confirmed") {
    return (
      <Chip tone="confirmed">
        <BadgeCheck className="h-3 w-3" aria-hidden />
        Confirmed
      </Chip>
    );
  }
  if (label === "Likely") {
    return (
      <Chip>
        <CircleHelp className="h-3 w-3" aria-hidden />
        Likely
      </Chip>
    );
  }
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <button type="button" className="rounded-full">
          <Chip tone="urgent">
            <ShieldQuestion className="h-3 w-3" aria-hidden />
            Unverified
          </Chip>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-[60] max-w-[260px] rounded-[10px] border border-line bg-raised px-3 py-2 text-sm"
        >
          Only {sourceCount || "one"} source{sourceCount === 1 ? "" : "s"} mention this show and
          none are a ticketing page yet. Check the source before you plan around it.
          <Tooltip.Arrow className="fill-[var(--surface-raised)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
