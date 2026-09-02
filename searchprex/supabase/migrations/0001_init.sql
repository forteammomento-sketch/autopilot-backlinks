-- Searchprex AI Visibility Autopilot — V0 schema
--
-- Scope: the measurement half of the loop (projects, prompts, runs, citations)
-- plus the tables the Action Engine and Proof screen will write into. Actions
-- and deployments are created here rather than in a later migration because
-- lift_measurements must exist from day one — the win/loss record is what
-- trains the ranker, and it cannot be backfilled.

create extension if not exists "pgcrypto";

-- ── tenancy ──────────────────────────────────────────────────────────────────

create table orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       text not null default 'trial',
  created_at timestamptz not null default now()
);

create table org_members (
  org_id  uuid not null references orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role    text not null default 'member' check (role in ('owner', 'member')),
  primary key (org_id, user_id)
);

create table projects (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs on delete cascade,
  domain              text not null,
  -- Aliases the answer text is matched against, beyond the domain label.
  brand_names         text[] not null default '{}',
  topic               text not null,
  locale              text not null default 'en-US',
  cms_kind            text check (cms_kind in ('github', 'shopify', 'wordpress', 'webflow', 'snippet')),
  -- Reference into Supabase Vault. Never store the token itself.
  cms_credentials_ref text,
  created_at          timestamptz not null default now()
);
create index on projects (org_id);

create table competitors (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  domain      text not null,
  brand_names text[] not null default '{}',
  unique (project_id, domain)
);

-- ── prompt universe ──────────────────────────────────────────────────────────

create table prompts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  text       text not null,
  intent     text not null check (intent in ('informational', 'comparison', 'commercial', 'brand')),
  cluster    text,
  is_active  boolean not null default true,
  source     text not null default 'generated' check (source in ('generated', 'user', 'gsc_import')),
  created_at timestamptz not null default now()
);
create index on prompts (project_id) where is_active;

-- ── measurement ──────────────────────────────────────────────────────────────

create table runs (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references projects on delete cascade,
  kind                   text not null default 'scheduled'
                           check (kind in ('baseline', 'scheduled', 'remeasure')),
  triggered_by_action_id uuid,
  started_at             timestamptz not null default now(),
  finished_at            timestamptz
);
create index on runs (project_id, started_at desc);

-- One row per individual engine call. Three attempts per (prompt, engine) is
-- the default, because these models answer the same prompt differently each
-- time; storing only an aggregate would hide that variance permanently.
create table run_results (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references runs on delete cascade,
  prompt_id           uuid not null references prompts on delete cascade,
  engine              text not null check (engine in ('perplexity', 'openai', 'gemini', 'aio', 'copilot')),
  attempt             smallint not null check (attempt >= 1),

  -- false = the engine ran but produced no answer surface. AI Overviews often
  -- does not fire; that is not the same as "the brand was not cited" and the
  -- two must never be collapsed.
  answered            boolean not null default true,
  answer_text         text,
  -- Storage path to the untouched provider payload, so historical runs stay
  -- re-parseable after an adapter rewrite.
  raw_ref             text,

  brand_mentioned     boolean not null default false,
  brand_cited         boolean not null default false,
  cited_at_position   int,
  first_mention_offset int,

  served_by           text,
  latency_ms          int,
  error_kind          text,
  error_message       text,
  created_at          timestamptz not null default now(),

  unique (run_id, prompt_id, engine, attempt),
  -- A citation position only makes sense when there was a citation.
  constraint cited_position_requires_citation
    check (cited_at_position is null or brand_cited)
);
create index on run_results (run_id, engine);

create table citations (
  id            uuid primary key default gen_random_uuid(),
  run_result_id uuid not null references run_results on delete cascade,
  position      int not null,
  url           text not null,
  domain        text not null,
  title         text,
  owner         text not null check (owner in ('self', 'competitor', 'third_party')),
  unique (run_result_id, position)
);
create index on citations (domain);
create index on citations (run_result_id) where owner = 'third_party';

-- Aggregate verdict across the attempts for one (run, prompt, engine).
-- 'contested' is a first-class state: cited in some attempts and not others.
-- Collapsing it into cited/absent is the most misleading thing this product
-- could do, so it is materialised rather than left to each caller.
create view prompt_samples as
select
  rr.run_id,
  rr.prompt_id,
  rr.engine,
  count(*) filter (where rr.error_kind is null)                    as succeeded,
  count(*) filter (where rr.brand_cited)                           as cited_count,
  count(*) filter (where rr.brand_mentioned)                       as mentioned_count,
  case
    when count(*) filter (where rr.error_kind is null) = 0 then 'unknown'
    when count(*) filter (where rr.brand_cited) = 0 then 'absent'
    when count(*) filter (where rr.brand_cited)
       = count(*) filter (where rr.error_kind is null) then 'cited'
    else 'contested'
  end                                                              as verdict
from run_results rr
group by rr.run_id, rr.prompt_id, rr.engine;

-- ── citation graph → placement targets ───────────────────────────────────────
--
-- The defensible artifact: link targets ranked by how often an engine actually
-- cites them for this project's prompts, rather than by domain authority.
create materialized view placement_targets as
select
  p.project_id,
  c.domain,
  count(distinct rr.prompt_id) as prompts_covered,
  count(*)                     as citation_count,
  max(rr.created_at)           as last_seen_at
from citations c
join run_results rr on rr.id = c.run_result_id
join prompts p      on p.id  = rr.prompt_id
where c.owner = 'third_party'
group by p.project_id, c.domain;
create unique index on placement_targets (project_id, domain);

-- ── action engine ────────────────────────────────────────────────────────────

create table gaps (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects on delete cascade,
  prompt_id       uuid not null references prompts on delete cascade,
  engine          text not null,
  gap_type        text not null check (gap_type in (
                    'bot_blocked', 'js_only', 'no_page', 'weak_passage',
                    'no_schema', 'orphan', 'rival_corroborated', 'not_ranking')),
  blocked_at_gate smallint not null check (blocked_at_gate between 1 and 4),
  our_url         text,
  rival_url       text,
  evidence        jsonb not null default '{}'::jsonb,
  detected_at     timestamptz not null default now()
);
create index on gaps (project_id, detected_at desc);

create table actions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  gap_id      uuid references gaps on delete set null,
  action_type text not null check (action_type in (
                'answer_block', 'schema', 'crawl_fix', 'internal_link',
                'placement', 'rank_first')),
  target_url  text,
  priority    numeric not null default 0,
  status      text not null default 'draft' check (status in (
                'draft', 'approved', 'deployed', 'verified', 'failed', 'rejected')),
  artifact    jsonb,
  -- Shown in the UI next to every recommendation. We do not present a
  -- hypothesis and a proven lever with the same confidence.
  certainty   text not null check (certainty in ('proven', 'strong', 'plausible')),
  created_at  timestamptz not null default now()
);
create index on actions (project_id, status, priority desc);

create table deployments (
  id              uuid primary key default gen_random_uuid(),
  action_id       uuid not null references actions on delete cascade,
  method          text not null check (method in ('github_pr', 'shopify', 'wordpress', 'webflow', 'snippet')),
  external_ref    text,
  -- Written before the deploy touches anything. This is the undo, and it is
  -- required, not optional.
  before_snapshot text not null,
  deployed_at     timestamptz not null default now(),
  rolled_back_at  timestamptz
);

create table lift_measurements (
  id              uuid primary key default gen_random_uuid(),
  action_id       uuid not null references actions on delete cascade,
  baseline_run_id uuid not null references runs,
  followup_run_id uuid references runs,
  cited_before    boolean not null,
  cited_after     boolean,
  measured_at     timestamptz,
  unique (action_id, baseline_run_id)
);

-- ── row level security ───────────────────────────────────────────────────────
--
-- Every tenant-scoped table is readable only through org membership. Jobs run
-- with the service-role key, which bypasses these; they re-verify project
-- ownership in application code rather than trusting the job payload.

create or replace function current_org_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;

alter table orgs               enable row level security;
alter table org_members        enable row level security;
alter table projects           enable row level security;
alter table competitors        enable row level security;
alter table prompts            enable row level security;
alter table runs               enable row level security;
alter table run_results        enable row level security;
alter table citations          enable row level security;
alter table gaps               enable row level security;
alter table actions            enable row level security;
alter table deployments        enable row level security;
alter table lift_measurements  enable row level security;

create policy org_read on orgs
  for select using (id in (select current_org_ids()));
create policy member_read on org_members
  for select using (org_id in (select current_org_ids()));
create policy project_rw on projects
  for all using (org_id in (select current_org_ids()))
  with check (org_id in (select current_org_ids()));

create policy competitor_rw on competitors for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));
create policy prompt_rw on prompts for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));
create policy run_rw on runs for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));
create policy gap_rw on gaps for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));
create policy action_rw on actions for all
  using (project_id in (select id from projects))
  with check (project_id in (select id from projects));

create policy run_result_read on run_results for select
  using (run_id in (select id from runs));
create policy citation_read on citations for select
  using (run_result_id in (select id from run_results));
create policy deployment_read on deployments for select
  using (action_id in (select id from actions));
create policy lift_read on lift_measurements for select
  using (action_id in (select id from actions));
