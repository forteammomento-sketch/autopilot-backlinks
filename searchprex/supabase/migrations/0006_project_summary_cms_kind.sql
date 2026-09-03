-- v_project_summary was missing cms_kind, which the dashboard reads to decide
-- what a deploy may promise. Without it every project looked like a git target,
-- so a Shopify store would have been offered "Open draft pull request" for a
-- write that goes straight to the live storefront -- the exact thing the
-- Shopify target was built to stop the UI saying.

create or replace view v_project_summary as
select
  pj.id,
  pj.org_id,
  pj.domain,
  pj.topic,
  (select count(*) from prompts where project_id = pj.id and is_active) as prompt_count,
  (select started_at from v_latest_run where project_id = pj.id)        as last_run_at,
  coalesce((
    select array_agg(distinct engine order by engine)
    from run_results rr
    join runs r on r.id = rr.run_id
    where r.project_id = pj.id
  ), '{}') as engines,
  (
    select count(*)
    from lift_measurements l
    join actions a on a.id = l.action_id
    where a.project_id = pj.id
      and not l.is_control
      and l.followup_total > 0
      and l.baseline_total > 0
      and (l.followup_cited::numeric / l.followup_total)
        > (l.baseline_cited::numeric / l.baseline_total)
      and l.measured_at > now() - interval '30 days'
  ) as citations_gained,
  pj.cms_kind
from projects pj;
