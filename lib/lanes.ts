import { laneFor } from "./scoring";
import type { ShowWithArtist } from "./types";

export type Lanes = { act_now: ShowWithArtist[]; home: ShowWithArtist[]; elsewhere: ShowWithArtist[] };

const ms = (s: string | null) => (s ? new Date(s).getTime() : Number.MAX_SAFE_INTEGER);

/** Radar lanes: Act now (by deadline), Coming to home city (by date), Elsewhere (by priority then date). */
export function groupIntoLanes(rows: ShowWithArtist[], now: Date = new Date()): Lanes {
  const lanes: Lanes = { act_now: [], home: [], elsewhere: [] };
  for (const s of rows) lanes[laneFor(s, now)].push(s);
  lanes.act_now.sort((a, b) => ms(a.early_bird_deadline) - ms(b.early_bird_deadline));
  lanes.home.sort((a, b) => a.start_date.localeCompare(b.start_date));
  lanes.elsewhere.sort((a, b) => b.priority_score - a.priority_score || a.start_date.localeCompare(b.start_date));
  return lanes;
}
