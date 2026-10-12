# Setup

Everything here is optional except **Supabase** and **Gemini** (needed for scanning). The app builds and runs
with **no** environment variables — missing pieces just show a friendly "Not connected yet" state.

Put keys in `.env.local` for local development, and in **Vercel → Project → Settings → Environment Variables**
for production. Never prefix a secret with `NEXT_PUBLIC_`.

Contents: [Supabase](#supabase) · [Gemini](#gemini) · [ScrapingBee](#scrapingbee) · [Google Cloud](#google-cloud) ·
[Gmail SMTP fallback](#gmail-smtp-fallback) · [Ticketmaster](#ticketmaster) · [Spotify](#spotify) · [Last.fm](#lastfm) ·
[No-key sources](#no-key-sources) · [Generate secrets](#generate-secrets) · [Vercel](#vercel) · [cron-job.org](#cron-joborg) ·
[First-run checklist](#first-run-checklist)

---

## Supabase

1. Go to <https://supabase.com> → **New project** (free tier is fine). Pick a region close to India (e.g. Mumbai).
2. Open **SQL Editor → New query**, paste the whole migration from the end of this file (also in
   `supabase/migrations/0001_init.sql`) and click **Run**.
3. (Optional) New query → paste `supabase/seed.sql` → **Run**. This loads the 40 starter artists. You can also run `npm run seed`.
4. **Project Settings → API** (or **Data API**): copy the **Project URL** → `SUPABASE_URL`, and the **service_role** key →
   `SUPABASE_SERVICE_ROLE_KEY`.

The service-role key is used **only on the server**. Row-level security is enabled on every table with no policies,
so the browser can never reach the database directly.

## Gemini

1. Go to <https://aistudio.google.com> → **Get API key** → **Create API key**.
2. Set `GEMINI_API_KEY`. Leave `GEMINI_MODEL=gemini-flash-latest` unless you want to pin a version.
3. The free tier has per-minute and per-day limits. The agent counts every call (`GEMINI_MAX_CALLS_PER_RUN`, default 12),
   backs off on 429s, and falls back to ticketing sources if the daily quota is exhausted.

## ScrapingBee

1. Sign up at <https://www.scrapingbee.com> → open the dashboard → copy your **API key** → `SCRAPINGBEE_API_KEY`.
2. The free trial includes a limited number of credits. A rendered page costs ~5 credits and a Google search ~15.
   `SCRAPINGBEE_DAILY_CREDIT_BUDGET` (default 150) is a hard daily cap: when reached, the agent logs
   "Scrape budget reached for today" and uses search results only.
3. The app only scrapes **public** ticketing pages and never sends cookies or credentials.

## Google Cloud

One connection powers both Gmail alerts and Calendar.

1. <https://console.cloud.google.com> → **New project**.
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → **External** → app name, support email, developer email →
   **Scopes**: add `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/calendar.events`
   → **Test users**: add your own Google account.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<your-app>.vercel.app/api/auth/google/callback`
5. Copy the **Client ID** → `GOOGLE_CLIENT_ID` and **Client secret** → `GOOGLE_CLIENT_SECRET`.
   Set `GOOGLE_REDIRECT_URI` to the callback URL for the environment you're in. Also set `ALERT_EMAIL_TO` (where alerts go).
6. ⚠️ **Publish the app to "In production"** (OAuth consent screen → **Publish app**).
   While the consent screen is in **Testing**, Google expires refresh tokens after **7 days** and you would have to
   reconnect weekly. When published, you'll see an "unverified app" screen once — choose **Advanced → Go to … (unsafe)**;
   this is your own app and only you use it.
7. `TOKEN_ENCRYPTION_KEY` must be set (see [Generate secrets](#generate-secrets)) — tokens are encrypted at rest.
   The **Connect Google** button is disabled until it exists.
8. In the app: **Settings → Connect Google**. If Google ever rejects the stored token (`invalid_grant`), Settings shows **Reconnect Google**.

## Gmail SMTP fallback

Only used if Google isn't connected.

1. Turn on **2-Step Verification** for the Gmail account: <https://myaccount.google.com/security>.
2. **App passwords** → create one named "Live Show Radar" → copy the 16-character password.
3. Set `GMAIL_SMTP_USER` (the Gmail address) and `GMAIL_SMTP_APP_PASSWORD`.

## Ticketmaster

<https://developer.ticketmaster.com> → sign up → **My Apps** → copy the **Consumer Key** → `TICKETMASTER_API_KEY`.
Coverage in India is thin; an empty result is normal and is treated as "no data", not an error.

## Spotify

1. <https://developer.spotify.com/dashboard> → **Create app**. Add redirect URIs
   `http://localhost:3000/api/auth/spotify/callback` and `https://<your-app>.vercel.app/api/auth/spotify/callback`; select **Web API**.
2. Copy **Client ID** / **Client secret** → `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`.
3. App **Settings → User Management**: add the Google/Spotify emails allowed to connect.
4. Spotify **Development Mode** requires the app owner to have **Premium** and limits sign-ins to allow-listed users
   (and, as of early 2026, a small user cap). Everyone else can add artists by name or import from Last.fm.

## Last.fm

<https://www.last.fm/api/account/create> → create an API account → copy the **API key** → `LASTFM_API_KEY`.
Import needs only a public username — no sign-in.

## No-key sources

MusicBrainz (artist search), Deezer (artist photos) and OpenStreetMap (Nominatim geocoding + map tiles) need no keys.
Set `CONTACT_EMAIL` so their required `User-Agent` identifies you. They are throttled to 1 request/second.

## Generate secrets

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

No `openssl` on Windows? In PowerShell: `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))`
(or use Git Bash, which includes it).

`ADMIN_PASSCODE` is optional: if set, changing alert settings/connections and deleting data asks for it once
(then a signed cookie lasts 30 days). Viewing, scanning, adding artists and "I'm going" never need it.

## Vercel

1. Push this repo to GitHub, then <https://vercel.com/new> → import it.
2. Add every environment variable for **Production** (and **Preview** if you want).
3. Deploy. Then update `APP_URL`, `GOOGLE_REDIRECT_URI` and `SPOTIFY_REDIRECT_URI` to the production URL and **redeploy**.
4. Hobby plans only allow **daily** crons, so `vercel.json` has one backup cron (`0 3 * * *` UTC = 08:30 IST).
   Fast scanning comes from cron-job.org (below).

## cron-job.org

1. Create a free account at <https://cron-job.org> → **Create cronjob**.
2. **URL**: `https://<your-app>.vercel.app/api/cron/scan` · **Schedule**: every **30 minutes**.
3. **Advanced → Headers**: add `Authorization` = `Bearer <CRON_SECRET>`.
4. Save → **Test run** (expect HTTP 200 with JSON).

Each run checks `SCAN_BATCH_SIZE` (4) artists, so 40 artists are covered every ~5 hours; favourites are prioritised every other run.
Alternative: `.github/workflows/scan.yml` (add `APP_URL` and `CRON_SECRET` repository secrets; GitHub may delay scheduled runs).

## First-run checklist

1. Open the app (no login). With only Supabase set you'll see the Radar with clearly-labelled **sample** cards.
2. **Settings → Connect Google**.
3. **Settings → Send me a test alert** — check your inbox.
4. Press **Check now** and watch **Activity** (the radar sweep + live log).
5. `npm run check:integrations` prints a ✅/❌ table for everything configured.

---

## Database migration (paste into the Supabase SQL editor)

```sql
create extension if not exists "pgcrypto";

-- Artists the user follows
create table if not exists artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null unique,
  mbid text,
  spotify_id text,
  disambiguation text,
  genres text[] default '{}',
  image_url text,
  origin text check (origin in ('india','international','unknown')) default 'unknown',
  source text not null check (source in ('seed','manual','lastfm','spotify')),
  is_favorite boolean not null default false,
  is_active boolean not null default true,
  last_scanned_at timestamptz,
  last_scan_status text,
  created_at timestamptz not null default now()
);

-- Venues (geocode cache)
create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  key text not null unique,
  lat double precision,
  lng double precision,
  geocoded_at timestamptz
);

-- Shows (one row per artist x city x start date)
create table if not exists shows (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references artists(id) on delete cascade,
  dedupe_key text not null unique,
  title text,
  event_type text not null default 'concert' check (event_type in ('concert','festival','club','other')),
  city text not null,
  city_slug text not null,
  state text,
  is_home_city boolean not null default false,
  venue_id uuid references venues(id),
  venue_name text,
  start_date date not null,
  end_date date,
  start_time time,
  ticket_url text,
  ticket_platform text,
  early_bird_status text not null default 'unknown'
    check (early_bird_status in ('open','closing_soon','imminent','sold_out','not_offered','unknown')),
  early_bird_deadline timestamptz,
  on_sale_at timestamptz,
  price_min_inr integer,
  price_max_inr integer,
  tiers jsonb not null default '[]',
  confidence numeric(3,2) not null default 0.5,
  priority_score integer not null default 0,
  sources jsonb not null default '[]',
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','postponed','past')),
  decision text check (decision in ('going','maybe','not_interested')),
  ai_brief jsonb,
  ai_brief_hash text,
  is_sample boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_enriched_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists shows_upcoming_idx on shows (start_date) where status = 'scheduled';
create index if not exists shows_priority_idx on shows (priority_score desc);

-- Change history -> drives alerts and the "what changed" UI
create table if not exists show_changes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  change_type text not null check (change_type in
    ('new_show','early_bird_opened','early_bird_closing_soon','early_bird_imminent','tier_sold_out',
     'date_changed','venue_changed','cancelled','deadline_found')),
  before jsonb, after jsonb,
  created_at timestamptz not null default now()
);

-- Alerts (idempotent)
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  change_id uuid references show_changes(id) on delete set null,
  channel text not null check (channel in ('gmail','smtp','in_app')),
  alert_type text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (show_id, alert_type, channel)
);

-- Calendar events created by the app (idempotent + undo)
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  kind text not null check (kind in ('concert','early_bird_deadline','on_sale','decide_reminder')),
  google_event_id text,
  html_link text,
  created_at timestamptz not null default now(),
  unique (show_id, kind)
);

-- Scan runs + live logs
create table if not exists scan_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron','manual','artist')),
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  artist_ids uuid[] not null default '{}',
  stats jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists scan_logs (
  id bigserial primary key,
  run_id uuid not null references scan_runs(id) on delete cascade,
  ts timestamptz not null default now(),
  level text not null default 'info' check (level in ('info','success','warn','error')),
  artist_name text,
  step text not null,
  message text not null
);
create index if not exists scan_logs_run_idx on scan_logs (run_id, id);

-- Key/value settings + OAuth tokens (encrypted)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists oauth_tokens (
  provider text primary key check (provider in ('google','spotify')),
  account_email text,
  scopes text[],
  refresh_token_enc text not null,
  access_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Usage metering, locks, rate limits
create table if not exists api_usage (
  day date not null,
  provider text not null,
  units integer not null default 0,
  primary key (day, provider)
);
create table if not exists locks (
  key text primary key,
  expires_at timestamptz not null
);
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- Atomic lock acquisition. Returns true only if the lock was taken (new, or expired).
create or replace function acquire_lock(p_key text, p_ttl_seconds int)
returns boolean language plpgsql as $$
declare
  affected integer;
begin
  insert into locks(key, expires_at) values (p_key, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update set expires_at = excluded.expires_at
    where locks.expires_at < now();
  get diagnostics affected = row_count;
  return affected > 0;
end $$;

create or replace function release_lock(p_key text) returns void language sql as $$
  delete from locks where key = p_key;
$$;

-- Atomic usage increment
create or replace function add_usage(p_provider text, p_units int) returns integer language sql as $$
  insert into api_usage(day, provider, units) values ((now() at time zone 'Asia/Kolkata')::date, p_provider, p_units)
  on conflict (day, provider) do update set units = api_usage.units + excluded.units
  returning units;
$$;

-- Atomic fixed-window rate limit. Returns the count inside the current window after incrementing.
create or replace function hit_rate_limit(p_key text, p_window_seconds int)
returns table(out_count integer, out_window_start timestamptz) language plpgsql as $$
begin
  return query
  insert into rate_limits as r(key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end
  returning r.count, r.window_start;
end $$;

alter table artists enable row level security;
alter table venues enable row level security;
alter table shows enable row level security;
alter table show_changes enable row level security;
alter table alerts enable row level security;
alter table calendar_events enable row level security;
alter table scan_runs enable row level security;
alter table scan_logs enable row level security;
alter table settings enable row level security;
alter table oauth_tokens enable row level security;
alter table api_usage enable row level security;
alter table locks enable row level security;
alter table rate_limits enable row level security;
```
