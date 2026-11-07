-- Server worker: full-length exports render on a server (ffmpeg, MP4 with audio) instead of
-- in the browser tab. Previews stay in the tab.

alter table exports add column format text not null default 'webm' check (format in ('webm', 'mp4'));

-- The tab may now be told to leave exports alone (p_exports = false when a server worker runs).
create or replace function claim_work(p_user uuid, p_worker text, p_quiet interval default interval '30 seconds', p_exports boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r removal_jobs; e exports;
begin
  update removal_jobs j
     set status = case when j.auto_detect and j.detected_mask is null then 'detecting' else 'rendering' end,
         progress = 0, heartbeat_at = now(), started_at = now(), attempts = j.attempts + 1, worker_ref = p_worker
   where j.id = (
     select id from removal_jobs
      where user_id = p_user
        and (status = 'queued' or (status in ('detecting', 'rendering') and heartbeat_at < now() - p_quiet and attempts < 3))
      order by (status = 'queued') desc, created_at
      limit 1 for update skip locked)
  returning j.* into r;
  if r.id is not null then return jsonb_build_object('kind', 'job', 'row', to_jsonb(r)); end if;
  if not p_exports then return null; end if;

  update exports x
     set status = 'rendering', progress = 0, heartbeat_at = now(), attempts = x.attempts + 1, worker_ref = p_worker
   where x.id = (
     select id from exports
      where user_id = p_user
        and (status = 'queued' or (status = 'rendering' and heartbeat_at < now() - p_quiet and attempts < 3))
      order by (status = 'queued') desc, created_at
      limit 1 for update skip locked)
  returning x.* into e;
  if e.id is not null then return jsonb_build_object('kind', 'export', 'row', to_jsonb(e)); end if;
  return null;
end $$;
drop function if exists claim_work(uuid, text, interval);
revoke all on function claim_work(uuid, text, interval, boolean) from public, anon, authenticated;

-- The server worker takes the oldest queued export from anyone, or one whose worker has been
-- quiet for a minute (crashed or redeployed). Several workers never take the same one.
create or replace function claim_export_any(p_worker text, p_quiet interval default interval '60 seconds')
returns exports language plpgsql security definer set search_path = public as $$
declare e exports;
begin
  update exports x
     set status = 'rendering', progress = 0, heartbeat_at = now(), attempts = x.attempts + 1, worker_ref = p_worker
   where x.id = (
     select id from exports
      where status = 'queued' or (status = 'rendering' and heartbeat_at < now() - p_quiet and attempts < 3)
      order by (status = 'queued') desc, created_at
      limit 1 for update skip locked)
  returning x.* into e;
  return e;
end $$;
revoke all on function claim_export_any(text, interval) from public, anon, authenticated;
