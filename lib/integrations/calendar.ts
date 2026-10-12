import { google } from "googleapis";
import { toGoogleEvent, type CalEvent } from "../calendar-build";
import { fail, ok, type Result } from "../result";
import { withGoogle } from "./google-oauth";

export async function createCalendarEvent(
  e: CalEvent,
  sourceUrl: string,
): Promise<Result<{ id: string; htmlLink: string | null }>> {
  const r = await withGoogle(async (auth) => {
    const cal = google.calendar({ version: "v3", auth });
    const res = await cal.events.insert({
      calendarId: "primary",
      requestBody: toGoogleEvent(e, sourceUrl),
    });
    return { id: res.data.id ?? "", htmlLink: res.data.htmlLink ?? null };
  });
  if (!r.ok) return r;
  if (!r.data.id) return fail("invalid_response", "Google returned no event id.");
  return ok(r.data);
}

export async function deleteCalendarEvent(googleEventId: string): Promise<Result<true>> {
  const r = await withGoogle(async (auth) => {
    const cal = google.calendar({ version: "v3", auth });
    try {
      await cal.events.delete({ calendarId: "primary", eventId: googleEventId });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 404 && code !== 410) throw err; // already gone is fine
    }
    return true as const;
  });
  return r;
}
