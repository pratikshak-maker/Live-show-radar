import { fmtDay } from "../time";

/** One-line in-app alert copy by change type. */
export function alertMessage(
  type: string,
  artist: string,
  city: string,
  startDate: string,
): string {
  const when = fmtDay(startDate);
  switch (type) {
    case "new_show":
      return `${artist} announced a show in ${city}, ${when}`;
    case "early_bird_opened":
      return `Early bird is open for ${artist} in ${city}, ${when}`;
    case "early_bird_closing_soon":
      return `Early bird closing soon: ${artist} in ${city}`;
    case "early_bird_imminent":
      return `Early bird opens soon: ${artist} in ${city}, ${when}`;
    case "deadline_found":
      return `Early-bird deadline found for ${artist} in ${city}`;
    case "date_changed":
      return `${artist} in ${city} has a new date: ${when}`;
    case "venue_changed":
      return `${artist} in ${city} moved venue`;
    case "cancelled":
      return `${artist} in ${city}, ${when} was cancelled`;
    case "tier_sold_out":
      return `A ticket tier sold out for ${artist} in ${city}`;
    default:
      return `${artist} in ${city}: update`;
  }
}
