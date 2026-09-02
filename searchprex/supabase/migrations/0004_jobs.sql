-- Job runs, with a lease so a schedule cannot fire the same work twice.
--
-- Cron is not exactly-once anywhere: a retry, two regions, or someone pressing
-- Run beside the schedule all produce a second call. A full measurement run is
-- prompts x engines x repeats -- 900 paid calls at 60 prompts -- so a duplicate
-- is a bill, not a warning.

create table job_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  job         text not null check (job in ('measure', 'remeasure', 'diagnose')),
  status      text not null default 'running'
                check (status in ('running', 'completed', 'failed', 'budget_exhausted', 'cancelled')),

  -- Held by whoever is running. A crashed worker leaves this in the past, and
  -- the next acquire reclaims it rather than blocking the job forever.
  lease_until timestamptz not null,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  calls_spent int not null default 0,
  error       text
);

-- The actual guard: at most one running row per project and job. This lives in
-- the database rather than in application logic because two processes racing is
-- exactly the case application logic gets wrong.
create unique index job_runs_one_active
  on job_runs (project_id, job)
  where status = 'running';

create index on job_runs (project_id, started_at desc);

alter table job_runs enable row level security;
create policy job_run_read on job_runs for select
  using (project_id in (select id from projects));

-- Reclaim leases whose holder died, then report whether one is free.
create or replace function acquire_job_lease(
  p_project uuid,
  p_job text,
  p_ttl_seconds int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update job_runs
     set status = 'failed',
         error = 'lease expired — the worker did not finish',
         finished_at = now()
   where project_id = p_project
     and job = p_job
     and status = 'running'
     and lease_until < now();

  begin
    insert into job_runs (project_id, job, lease_until)
    values (p_project, p_job, now() + make_interval(secs => p_ttl_seconds))
    returning id into v_id;
  exception when unique_violation then
    -- Someone else holds it. Not an error: the other run is doing the work.
    return null;
  end;

  return v_id;
end;
$$;

create or replace function release_job_lease(
  p_id uuid,
  p_status text,
  p_calls int,
  p_error text
) returns void
language sql security definer set search_path = public as $$
  update job_runs
     set status = p_status,
         finished_at = now(),
         calls_spent = coalesce(p_calls, 0),
         error = p_error
   where id = p_id;
$$;
