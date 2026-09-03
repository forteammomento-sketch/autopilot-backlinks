-- Cross-tenant leak: every view ran with its owner's rights.
--
-- A Postgres view executes as the role that OWNS it, not the role querying it,
-- so row-level security on the underlying tables is simply not applied. Every
-- table here was correctly locked down and every view handed the data straight
-- back out: one customer could read another customer's prompts, visibility,
-- action queue and connections by selecting from any view. The tables were
-- never the hole; the views were.
--
-- `security_invoker` makes a view run as the caller, which is what makes the
-- table policies apply. It is off by default for backwards compatibility, which
-- is exactly why this is easy to ship without noticing.

alter view prompt_samples      set (security_invoker = on);
alter view action_win_rates    set (security_invoker = on);
alter view v_latest_run        set (security_invoker = on);
alter view v_prompt_visibility set (security_invoker = on);
alter view v_action_queue      set (security_invoker = on);
alter view v_refusals          set (security_invoker = on);
alter view v_proof             set (security_invoker = on);
alter view v_project_summary   set (security_invoker = on);
alter view v_connections       set (security_invoker = on);

-- `placement_targets` is a MATERIALIZED view, and materialized views cannot
-- carry row-level security or `security_invoker` at all -- they are a stored
-- table of rows with no policy support. So the tenant filter has to be written
-- into the view that reads it, and direct access has to be withdrawn.
create or replace view v_placements with (security_invoker = on) as
select
  t.project_id,
  t.domain,
  t.prompts_covered,
  t.citation_count,
  exists (
    select 1
    from citations c
    join run_results rr on rr.id = c.run_result_id
    join prompts p on p.id = rr.prompt_id
    where p.project_id = t.project_id
      and c.owner = 'competitor'
      and exists (
        select 1 from citations c2
        where c2.run_result_id = rr.id and c2.domain = t.domain
      )
  ) as rival_present,
  (
    select p.text
    from citations c
    join run_results rr on rr.id = c.run_result_id
    join prompts p on p.id = rr.prompt_id
    where p.project_id = t.project_id and c.domain = t.domain
    order by p.text
    limit 1
  ) as example_prompt
from placement_targets t
-- The guard the materialized view cannot enforce for itself. With
-- security_invoker on, this subquery is subject to the caller's policy on
-- `projects`, so it resolves to the tenant's own projects and nothing else.
where t.project_id in (select id from projects);

-- Nothing should reach the materialized view directly; it has no policies to
-- protect it. Guarded so this migration still runs on a database without the
-- Supabase client roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on placement_targets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on placement_targets from authenticated';
  end if;
end $$;
