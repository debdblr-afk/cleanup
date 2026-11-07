-- BUG-003: after a refresh mid-clean, the old tab's worker id still held the job, so the card
-- froze until the 5-minute sweep. A user's own tab may now take back that user's work once
-- it has been quiet for 30 seconds (the tab worker reports at least every 10 s while working).
-- Queued work still comes first; nothing is ever taken from another user.
create or replace function claim_work(p_user uuid, p_worker text, p_quiet interval default interval '30 seconds')
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

drop function if exists claim_work(uuid, text);
revoke all on function claim_work(uuid, text, interval) from public, anon, authenticated;
