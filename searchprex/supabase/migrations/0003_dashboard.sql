-- Everything the dashboard reads, plus the two things the V0 code produces that
-- the original schema had nowhere to put.

-- ── gaps the original schema left ────────────────────────────────────────────

-- The Action Engine writes a rationale for every action; it is the sentence the
-- customer reads above the artifact, so it belongs beside the artifact.
alter table actions add column rationale text;

-- Refusals were missing entirely. That was a real omission: a refusal naming the
-- missing first-party fact is often the most actionable row in the queue, and
-- storing it nowhere meant the customer never saw why nothing was generated.
create table refusals (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  gap_id      uuid references gaps on delete set null,
  prompt_id   uuid references prompts on delete set null,
  action_type text not null,
  engine      text not null,
  reason      text not null check (reason in (
                'no_first_party_facts', 'duplicate_of_existing',
                'validation_failed', 'not_retrievable')),
  -- Shown to the customer verbatim: what would unblock this.
  needed      text not null,
  created_at  timestamptz not null default now()
);
create index on refusals (project_id, created_at desc);

alter table refusals enable row level security;
create policy refusal_rw on refusals for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));

-- A deploy writes one row per pull request; the rollback payload lives in
-- deployments.before_snapshot, which already exists.
alter table deployments add column pr_number int;
alter table deployments add column pr_url text;

-- ── views the dashboard reads ────────────────────────────────────────────────
--
-- The screens read views, not tables. A screen should not have to know that a
-- prompt's text lives two joins away from the action that addresses it, and
-- keeping the joins here means the query plan is tuned once rather than in
-- every component.

create view v_latest_run as
select distinct on (project_id) id as run_id, project_id, started_at
from runs
where finished_at is not null
order by project_id, started_at desc;

create view v_prompt_visibility as
select
  p.project_id,
  p.id            as prompt_id,
  p.text          as prompt,
  p.intent,
  coalesce(p.cluster, 'uncategorised') as cluster,
  s.engine,
  s.verdict,
  s.cited_count   as cited,
  s.succeeded     as total,
  -- Competitor domains cited for this prompt in the same run.
  coalesce((
    select array_agg(distinct c.domain order by c.domain)
    from run_results rr
    join citations c on c.run_result_id = rr.id
    where rr.run_id = s.run_id
      and rr.prompt_id = p.id
      and c.owner = 'competitor'
  ), '{}') as rivals
from prompts p
join v_latest_run lr on lr.project_id = p.project_id
join prompt_samples s on s.prompt_id = p.id and s.run_id = lr.run_id
where p.is_active;

create view v_action_queue as
select
  a.id,
  a.project_id,
  a.action_type,
  a.target_url,
  a.priority,
  a.certainty,
  a.status,
  a.artifact,
  coalesce(a.rationale, g.evidence ->> 'reason', '') as rationale,
  g.gap_type,
  g.blocked_at_gate as gate,
  g.engine,
  coalesce(pr.text, '') as prompt,
  d.pr_url,
  d.deployed_at
from actions a
left join gaps g on g.id = a.gap_id
left join prompts pr on pr.id = g.prompt_id
left join lateral (
  select pr_url, deployed_at from deployments
  where action_id = a.id and rolled_back_at is null
  order by deployed_at desc limit 1
) d on true
where a.status <> 'rejected';

create view v_refusals as
select
  r.id,
  r.project_id,
  r.action_type,
  r.reason,
  r.engine,
  r.needed,
  coalesce(p.text, '') as prompt
from refusals r
left join prompts p on p.id = r.prompt_id;

-- Placement targets, with whether a competitor is already cited on that domain.
-- That flag is what turns a list of pages into a worklist: a domain quoting a
-- rival for your prompt is a page you are losing on today.
create view v_placements as
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
from placement_targets t;

create view v_proof as
select
  l.id,
  a.project_id,
  l.action_type,
  coalesce(p.text, '') as prompt,
  l.engine,
  l.baseline_cited,
  l.baseline_total,
  l.followup_cited,
  l.followup_total,
  l.direction,
  l.confident,
  l.is_control,
  l.deferred_reason,
  l.measured_at,
  dep.deployed_at
from lift_measurements l
join actions a on a.id = l.action_id
left join prompts p on p.id = l.prompt_id
left join lateral (
  select deployed_at from deployments
  where action_id = a.id order by deployed_at desc limit 1
) dep on true;

create view v_project_summary as
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
  -- The renewal metric: prompt/engine pairs whose citation rate rose in the
  -- last 30 days, control rows excluded because nothing was deployed for them.
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
  ) as citations_gained
from projects pj;
