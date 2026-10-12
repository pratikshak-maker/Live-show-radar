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
