-- Cleanup: first migration. Based on replica-watermark/schema.sql (tested 2026-11-07) with
-- what the app needs on top: a work-claiming function for workers, event-time guards for
-- Stripe, guest plans via anonymous auth, and storage keys.
--
-- Access rules: row level security. Signed-in users (including anonymous guests) can SELECT
-- their own rows; the app reads through RLS and Realtime. Every write goes through a route
-- handler that checks ownership and uses the service role. No client-side writes.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_anonymous boolean not null default true,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')), -- set by refresh_plan() only
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();

create or replace function handle_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, is_anonymous)
  values (new.id, new.email, coalesce(new.is_anonymous, false))
  on conflict (id) do update set email = excluded.email, is_anonymous = excluded.is_anonymous;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function handle_auth_user();
create trigger on_auth_user_updated after update of email, is_anonymous on auth.users for each row execute function handle_auth_user();

-- ---------------------------------------------------------------------------
-- subscriptions + stripe_events
-- ---------------------------------------------------------------------------

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  plan text not null check (plan in ('plus', 'pro')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (char_length(currency) = 3),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_event_at timestamptz not null, -- created time of the newest event applied; older events are ignored
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on subscriptions (user_id);
create trigger subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();

create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- The plan a user gets: the best subscription that still entitles them. past_due keeps access
-- during Stripe's retry window; canceled/unpaid/incomplete do not.
create or replace function refresh_plan(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_plan text;
begin
  select coalesce(
    (select s.plan from subscriptions s
      where s.user_id = p_user and s.status in ('active', 'trialing', 'past_due')
      order by (s.plan = 'pro') desc, s.updated_at desc limit 1),
    'free') into v_plan;
  update profiles set plan = v_plan where id = p_user and plan is distinct from v_plan;
  return v_plan;
end $$;

-- ---------------------------------------------------------------------------
-- batches, videos
-- ---------------------------------------------------------------------------

create table batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text check (char_length(name) <= 120),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index batches_user_idx on batches (user_id, created_at desc);
create index batches_expiry_idx on batches (expires_at);
create trigger batches_updated_at before update on batches for each row execute function set_updated_at();

create table videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  position integer not null default 0,
  source text not null check (source in ('upload', 'url', 'sample')),
  source_url text,
  filename text not null check (char_length(filename) between 1 and 255),
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'uploading' check (status in ('uploading', 'probing', 'ready', 'rejected', 'deleted')),
  reject_reason text check (reject_reason in ('too_long', 'too_large', 'unsupported', 'corrupt', 'fetch_failed')),
  original_key text not null,
  thumbnail_key text,
  duration_ms integer check (duration_ms > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  rights_attested_at timestamptz not null,
  attestation_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint url_needs_source check (source <> 'url' or source_url is not null)
);
create index videos_batch_idx on videos (batch_id, position);
create index videos_user_idx on videos (user_id, created_at desc);
create index videos_expiry_idx on videos (expires_at) where status <> 'deleted';
create trigger videos_updated_at before update on videos for each row execute function set_updated_at();

create or replace function enforce_batch_size() returns trigger
language plpgsql as $$
begin
  perform 1 from batches where id = new.batch_id for update;
  if (select count(*) from videos where batch_id = new.batch_id and status <> 'deleted') >= 30 then
    raise exception 'batch_full' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger videos_batch_size before insert on videos for each row execute function enforce_batch_size();

-- ---------------------------------------------------------------------------
-- removal_jobs, exports
-- ---------------------------------------------------------------------------

create table removal_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  parent_job_id uuid references removal_jobs(id) on delete set null,
  mode text not null default 'watermark' check (mode in ('watermark', 'subtitle', 'text', 'object', 'person')),
  auto_detect boolean not null default true,
  mask jsonb not null default '{"regions":[]}'::jsonb,
  detected_mask jsonb,
  status text not null default 'queued' check (status in ('queued', 'detecting', 'rendering', 'done', 'failed', 'canceled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  preview_key text,
  preview_ms integer,
  error_code text,
  error_message text,
  attempts smallint not null default 0,
  worker_ref text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  quota_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mask_has_regions check (jsonb_typeof(mask -> 'regions') = 'array')
);
create index removal_jobs_video_idx on removal_jobs (video_id, created_at);
create index removal_jobs_user_idx on removal_jobs (user_id, created_at);
create index removal_jobs_parent_idx on removal_jobs (parent_job_id);
create index removal_jobs_queue_idx on removal_jobs (user_id, created_at) where status = 'queued';
create index removal_jobs_active_idx on removal_jobs (heartbeat_at) where status in ('detecting', 'rendering');
create trigger removal_jobs_updated_at before update on removal_jobs for each row execute function set_updated_at();

create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_id uuid not null references removal_jobs(id) on delete cascade,
  resolution text not null check (resolution in ('720p', '1080p', '1440p', '2160p')),
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  result_key text,
  size_bytes bigint check (size_bytes > 0),
  error_message text,
  attempts smallint not null default 0,
  worker_ref text,
  quota_date date not null,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exports_one_live_per_res on exports (job_id, resolution) where status <> 'failed';
create index exports_user_idx on exports (user_id, created_at);
create index exports_queue_idx on exports (user_id, created_at) where status = 'queued';
create index exports_active_idx on exports (heartbeat_at) where status = 'rendering';
create trigger exports_updated_at before update on exports for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Daily caps
-- ---------------------------------------------------------------------------

create table usage_daily (
  user_id uuid not null references profiles(id) on delete cascade,
  usage_date date not null,
  kind text not null check (kind in ('preview', 'export')),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, kind)
);

create or replace function consume_quota(p_user uuid, p_kind text, p_cap integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if p_cap <= 0 then return false; end if;
  insert into usage_daily (user_id, usage_date, kind, count)
  values (p_user, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, usage_date, kind)
  do update set count = usage_daily.count + 1, updated_at = now() where usage_daily.count < p_cap
  returning count into v_count;
  return v_count is not null;
end $$;

create or replace function refund_quota(p_user uuid, p_kind text, p_date date)
returns void language sql security definer set search_path = public as $$
  update usage_daily set count = count - 1, updated_at = now()
  where user_id = p_user and kind = p_kind and usage_date = p_date and count > 0;
$$;

-- ---------------------------------------------------------------------------
-- Work claiming. One queued item at a time per call, oldest first, safe across tabs and
-- workers (skip locked). Previews before exports. Returns {kind, row} or null.
-- ---------------------------------------------------------------------------

create or replace function claim_work(p_user uuid, p_worker text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r removal_jobs; e exports;
begin
  update removal_jobs j
     set status = case when j.auto_detect then 'detecting' else 'rendering' end,
         progress = 0, heartbeat_at = now(), started_at = now(), attempts = j.attempts + 1, worker_ref = p_worker
   where j.id = (select id from removal_jobs where user_id = p_user and status = 'queued' order by created_at limit 1 for update skip locked)
  returning j.* into r;
  if r.id is not null then return jsonb_build_object('kind', 'job', 'row', to_jsonb(r)); end if;

  update exports x
     set status = 'rendering', progress = 0, heartbeat_at = now(), attempts = x.attempts + 1, worker_ref = p_worker
   where x.id = (select id from exports where user_id = p_user and status = 'queued' order by created_at limit 1 for update skip locked)
  returning x.* into e;
  if e.id is not null then return jsonb_build_object('kind', 'export', 'row', to_jsonb(e)); end if;
  return null;
end $$;

-- Work whose worker went quiet (tab closed, crash): back to the queue, or failed after 3 tries.
create or replace function sweep_stuck(p_quiet interval default interval '2 minutes')
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in
    update removal_jobs set status = case when attempts >= 3 then 'failed' else 'queued' end,
           error_code = case when attempts >= 3 then 'render_failed' else error_code end,
           error_message = case when attempts >= 3 then 'The cleaner stopped responding. Your preview was given back.' else error_message end,
           finished_at = case when attempts >= 3 then now() else null end, progress = 0
     where status in ('detecting', 'rendering') and heartbeat_at < now() - p_quiet
    returning id, user_id, status, quota_date
  loop
    n := n + 1;
    if r.status = 'failed' then perform refund_quota(r.user_id, 'preview', r.quota_date); end if;
  end loop;
  for r in
    update exports set status = case when attempts >= 3 then 'failed' else 'queued' end,
           error_message = case when attempts >= 3 then 'The export stopped responding. Your export was given back.' else error_message end,
           finished_at = case when attempts >= 3 then now() else null end, progress = 0
     where status = 'rendering' and heartbeat_at < now() - p_quiet
    returning id, user_id, status, quota_date
  loop
    n := n + 1;
    if r.status = 'failed' then perform refund_quota(r.user_id, 'export', r.quota_date); end if;
  end loop;
  return n;
end $$;

revoke all on function consume_quota(uuid, text, integer) from public, anon, authenticated;
revoke all on function refund_quota(uuid, text, date) from public, anon, authenticated;
revoke all on function claim_work(uuid, text) from public, anon, authenticated;
revoke all on function sweep_stuck(interval) from public, anon, authenticated;
revoke all on function refresh_plan(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- takedown_requests
-- ---------------------------------------------------------------------------

create table takedown_requests (
  id uuid primary key default gen_random_uuid(),
  reporter_name text not null check (char_length(reporter_name) <= 200),
  reporter_email text not null check (char_length(reporter_email) <= 320),
  rights_holder text not null check (char_length(rights_holder) <= 200),
  work_description text not null check (char_length(work_description) <= 5000),
  infringing_ref text not null check (char_length(infringing_ref) <= 2000),
  good_faith_statement boolean not null check (good_faith_statement),
  signature text not null check (char_length(signature) <= 200),
  status text not null default 'received' check (status in ('received', 'reviewing', 'actioned', 'rejected')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index takedown_requests_status_idx on takedown_requests (status, created_at);
create trigger takedown_requests_updated_at before update on takedown_requests for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table stripe_events enable row level security;
alter table batches enable row level security;
alter table videos enable row level security;
alter table removal_jobs enable row level security;
alter table exports enable row level security;
alter table usage_daily enable row level security;
alter table takedown_requests enable row level security;

create policy "read own profile" on profiles for select to authenticated using (id = (select auth.uid()));
create policy "read own subscriptions" on subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "read own batches" on batches for select to authenticated using (user_id = (select auth.uid()));
create policy "read own videos" on videos for select to authenticated using (user_id = (select auth.uid()) and status <> 'deleted');
create policy "read own jobs" on removal_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy "read own exports" on exports for select to authenticated using (user_id = (select auth.uid()));
create policy "read own usage" on usage_daily for select to authenticated using (user_id = (select auth.uid()));

-- Live updates for cards, the editor and the plan badge.
alter publication supabase_realtime add table profiles, videos, removal_jobs, exports, usage_daily;

-- Storage: the media bucket is private with no policies, so only the server (service role)
-- can read or write, by handing out short-lived signed URLs after an ownership check.
