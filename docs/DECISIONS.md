# Decisions

A log of judgment calls, and every place the build deviates from the original prompt because of the official docs.

## Deviations driven by official docs

- **ScrapingBee auth.** The prompt used an `api_key` query parameter. The current docs mark it deprecated in favour of
  `Authorization: Bearer <key>`, so the wrapper sends the header and never puts the key in a URL.
- **ScrapingBee credit header.** The docs list `Spb-auto-cost` (Auto-Mode only) but do **not** document `Spb-Cost`. The wrapper still
  reads `Spb-Cost` if present, otherwise assumes **5** credits per rendered page and **15** per Google search (conservative estimate;
  the docs don't state the Google cost). The daily budget therefore errs on the safe side.
- **ScrapingBee Google Search response.** Organic results use `url` (not `link`) and include `domain`.
- **Spotify.** The February 2026 migration guide removes `PUT/DELETE /me/following` and the "contains" check but does **not** remove
  `GET /me/following?type=artist`, which is all the app uses (scope `user-follow-read`). Dev Mode needs an owner with Premium and
  an allow-list, as the prompt said.
- **Gemini grounding.** `groundingChunks[].web.domain` is documented as not supported in the Gemini API, so the domain is derived from the
  resolved redirect URL. Grounding and JSON mode stay in separate calls (two-pass design).
- **Next.js 16 / React 19 / ESLint 9.** `next lint` is gone, so `npm run lint` runs ESLint directly with the flat config.
  `package.json` is `"type": "module"`.
- **`@google/genai` 2.x** takes `abortSignal` inside `config`; that is how the 30 s / 20 s timeouts are enforced.

## Judgment calls

- **Build location.** The session folder held an unrelated project, so the app lives in its own folder/repo (`live-show-radar`).
- **Artist removal is a soft delete** (`is_active=false` via PATCH) so **Undo** is trivial and needs no passcode. The hard `DELETE` route
  (cascades to shows) exists and is admin-only when `ADMIN_PASSCODE` is set.
- **Atomic rate limiting.** `hit_rate_limit()` is a SQL function (one statement) instead of read-modify-write in Node, so concurrent
  serverless invocations can't undercount. The pure window logic is still unit-tested.
- **`acquire_lock`** uses `GET DIAGNOSTICS row_count` after the conditional upsert. A PGlite test proves a second call within the TTL
  returns `false` and that an expired lock can be re-taken.
- **Concert event with unknown time → all-day event.** The prompt said both "19:00 if unknown" and "all-day if unknown"; the later,
  more specific rule wins.
- **Early-bird deadline event when the deadline is very close.** If `deadline − 30 min` is already past, the event starts one minute
  from now and ends at the deadline (minimum 15 minutes) so it is never created in the past.
- **±1 day merges.** A listing one day off is usually timezone noise, so the existing date is kept; a date from a ticketing-confirmed
  source overrides it and emits `date_changed`.
- **New shows emit only `new_show`.** Emitting `early_bird_opened` too would double-alert for the same show.
- **Skipped emails are not replayed.** If email wasn't configured when a change happened, connecting Google later doesn't dump stale
  alerts into the inbox.
- **Rule-based fallback** (no Gemini): Ticketmaster events plus JSON-LD `Event` blocks from scraped ticketing pages. JSON-LD-only
  candidates are capped at 0.55 confidence ("Unverified"); Ticketmaster candidates are treated as ticketing-confirmed.
- **Grounded evidence is cite-able per source.** Each grounded source URL becomes its own evidence block so the model can cite any of
  them, and validation requires every cited URL to be one of those blocks.
- **Home city** can be changed in Settings (stored in `settings`, overrides `HOME_CITY`).
- **Email threshold** `min_confidence_for_email` defaults to 0.5 and is stored in settings.
- **Theme toggle** lives in the desktop header and in Settings (the mobile header only carries logo, scan and bell, per spec).
- **Dev-only routes** `/dev/cards` and `/dev/radar` render fixture data and return 404 in production.
- **Setup links** point at `lib/constants.ts → REPO_URL`; now points at github.com/pratikshak-maker/Live-show-radar.
- **Venue geocoding** runs lazily: a few venues at the end of a scan if time remains, and on first map view.
- **Test coverage of the database layer** uses PGlite (Postgres in WASM) to run the real migration and seed; Supabase-client calls
  themselves are exercised only against a live project.
