import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The migrations, run against real Postgres.
 *
 * PGlite is Postgres compiled to WebAssembly, so this is not a parser check —
 * the DDL executes, the views are planned, the constraints are enforced and the
 * functions run. Migrations are the one part of this system that cannot be
 * verified any other way: SQL that reads correctly can still reference a column
 * that does not exist, and the first time anyone finds out is on a real
 * database with real data.
 */
const MIGRATIONS = 'supabase/migrations';

/**
 * What Supabase supplies and PGlite does not. `gen_random_uuid()` has been core
 * since Postgres 13, so the pgcrypto line is stripped rather than emulated.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid());
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

let db: PGlite;
let project: string;
let run: string;
let prompt: string;
let action: string;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0] as T;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8').replace(
      /create extension if not exists "pgcrypto";/g,
      '',
    );
    await db.exec(sql);
  }

  const org = (await one<{ id: string }>(`insert into orgs (name) values ('MSO') returning id`)).id;
  project = (
    await one<{ id: string }>(
      `insert into projects (org_id, domain, slug, brand_names, topic, cms_kind)
       values ($1, 'michigansportsoutdoor.com', 'mso', '{"MSO"}', 'knives', 'shopify')
       returning id`,
      [org],
    )
  ).id;
  await db.query(
    `insert into competitors (project_id, domain, brand_names)
     values ($1, 'bladehq.com', '{"Blade HQ"}')`,
    [project],
  );
  prompt = (
    await one<{ id: string }>(
      `insert into prompts (project_id, text, intent, cluster)
       values ($1, 'best budget barlow knife under $40', 'commercial', 'pocket knives')
       returning id`,
      [project],
    )
  ).id;
  run = (
    await one<{ id: string }>(
      `insert into runs (project_id, kind, finished_at) values ($1, 'baseline', now()) returning id`,
      [project],
    )
  ).id;

  // Cited in one attempt of three: the "contested" state the product turns on.
  for (const [attempt, cited] of [[1, true], [2, false], [3, false]] as const) {
    const rr = (
      await one<{ id: string }>(
        `insert into run_results (run_id, prompt_id, engine, attempt, brand_cited, cited_at_position)
         values ($1, $2, 'perplexity', $3, $4, $5) returning id`,
        [run, prompt, attempt, cited, cited ? 2 : null],
      )
    ).id;
    await db.query(
      `insert into citations (run_result_id, position, url, domain, owner) values
         ($1, 1, 'https://bladehq.com/x', 'bladehq.com', 'competitor'),
         ($1, 2, 'https://reddit.com/r/knives', 'reddit.com', 'third_party')`,
      [rr],
    );
  }

  const gap = (
    await one<{ id: string }>(
      `insert into gaps (project_id, prompt_id, engine, gap_type, blocked_at_gate, evidence)
       values ($1, $2, 'perplexity', 'weak_passage', 3, '{"reason":"thin"}') returning id`,
      [project, prompt],
    )
  ).id;
  action = (
    await one<{ id: string }>(
      `insert into actions (project_id, gap_id, action_type, target_url, priority, certainty,
                            rationale, status)
       values ($1, $2, 'answer_block', 'https://mso.com/products/barlow', 2.0, 'proven',
               'because', 'approved') returning id`,
      [project, gap],
    )
  ).id;
  await db.query(
    `insert into refusals (project_id, prompt_id, action_type, engine, reason, needed)
     values ($1, $2, 'answer_block', 'perplexity', 'no_first_party_facts', 'a spec')`,
    [project, prompt],
  );
  await db.query(
    `insert into deployments (action_id, method, before_snapshot, pr_number, pr_url)
     values ($1, 'github_pr', '<p>before</p>', 7, 'https://github.com/o/r/pull/7')`,
    [action],
  );
  await db.query(
    `insert into lift_measurements
       (action_id, baseline_run_id, action_type, prompt_id, engine, baseline_cited,
        baseline_total, followup_cited, followup_total, direction, confident, measured_at)
     values ($1, $2, 'answer_block', $3, 'perplexity', 0, 3, 3, 3, 'gained', true, now())`,
    [action, run, prompt],
  );
  await db.exec('refresh materialized view placement_targets');
}, 60_000);

describe('views', () => {
  it('reports "contested" for one attempt in three', async () => {
    const row = await one<{ verdict: string; cited_count: number; succeeded: number }>(
      `select verdict, cited_count, succeeded from prompt_samples`,
    );
    expect(row.verdict).toBe('contested');
    expect(row.cited_count).toBe(1);
    expect(row.succeeded).toBe(3);
  });

  it('joins the latest run and lists the rivals cited instead', async () => {
    const row = await one<{ rivals: string; verdict: string }>(
      `select rivals, verdict from v_prompt_visibility`,
    );
    expect(String(row.rivals)).toContain('bladehq.com');
  });

  it('keeps competitors out of the placement targets', async () => {
    const rows = (await db.query<{ domain: string }>(`select domain from placement_targets`)).rows;
    expect(rows.map((r) => r.domain)).toEqual(['reddit.com']);
  });

  it('flags a placement target where a rival is already cited', async () => {
    const row = await one<{ rival_present: boolean }>(`select rival_present from v_placements`);
    expect(row.rival_present).toBe(true);
  });

  it('carries the prompt, gate and deployment into the action queue', async () => {
    const row = await one<{ gate: number; rationale: string; prompt: string; pr_url: string }>(
      `select gate, rationale, prompt, pr_url from v_action_queue`,
    );
    expect(row.gate).toBe(3);
    expect(row.prompt).toContain('barlow');
    expect(row.pr_url).toBe('https://github.com/o/r/pull/7');
  });

  it('hides a rejected action from the queue', async () => {
    await db.query(`update actions set status = 'rejected' where id = $1`, [action]);
    const row = await one<{ n: number }>(`select count(*)::int as n from v_action_queue`);
    await db.query(`update actions set status = 'approved' where id = $1`, [action]);
    expect(row.n).toBe(0);
  });

  it('resolves the prompt behind a refusal', async () => {
    const row = await one<{ prompt: string }>(`select prompt from v_refusals`);
    expect(row.prompt).toContain('barlow');
  });

  it('reports no win rate off a single record', async () => {
    // The sample floor lives in SQL as well as in the ranker.
    const row = await one<{ n: number }>(`select count(*)::int as n from action_win_rates`);
    expect(row.n).toBe(0);
  });

  it('counts a citation gained in the last 30 days', async () => {
    const row = await one<{ citations_gained: string; cms_kind: string }>(
      `select citations_gained, cms_kind from v_project_summary`,
    );
    expect(Number(row.citations_gained)).toBe(1);
    expect(row.cms_kind).toBe('shopify');
  });

  it('never exposes the sealed credential', async () => {
    const rows = (
      await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'v_connections'`,
      )
    ).rows;
    expect(rows.some((r) => r.column_name.includes('refresh_token'))).toBe(false);
  });
});

/**
 * Every column the dashboard selects, asserted to exist.
 *
 * This caught a real one: `v_project_summary` did not expose `cms_kind`, so a
 * Shopify project read as a git target and would have been offered "Open draft
 * pull request" for a write that goes straight to the live storefront.
 */
const VIEW_CONTRACT: Record<string, string[]> = {
  v_project_summary: [
    'domain', 'topic', 'last_run_at', 'citations_gained', 'prompt_count', 'engines', 'cms_kind',
  ],
  v_prompt_visibility: [
    'prompt_id', 'prompt', 'intent', 'cluster', 'engine', 'verdict', 'cited', 'total', 'rivals',
  ],
  v_action_queue: [
    'id', 'action_type', 'gap_type', 'gate', 'prompt', 'engine', 'target_url', 'priority',
    'certainty', 'rationale', 'status', 'artifact', 'pr_url',
  ],
  v_refusals: ['id', 'action_type', 'reason', 'prompt', 'engine', 'needed'],
  v_placements: [
    'project_id', 'domain', 'prompts_covered', 'citation_count', 'rival_present', 'example_prompt',
  ],
  v_proof: [
    'id', 'project_id', 'action_type', 'prompt', 'engine', 'baseline_cited', 'baseline_total',
    'followup_cited', 'followup_total', 'direction', 'confident', 'is_control', 'deferred_reason',
    'measured_at', 'deployed_at',
  ],
  v_connections: ['site_url', 'account_email', 'connected_at'],
};

describe('view contract', () => {
  for (const [view, columns] of Object.entries(VIEW_CONTRACT)) {
    it(`${view} exposes every column the app reads`, async () => {
      const rows = (
        await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_name = $1`,
          [view],
        )
      ).rows;
      const present = new Set(rows.map((r) => r.column_name));
      expect(columns.filter((c) => !present.has(c))).toEqual([]);
    });
  }
});

describe('project slugs', () => {
  it('are unique across every org', async () => {
    // The slug appears in a URL with no org segment in front of it. Two orgs
    // holding the same one makes /p/<slug> ambiguous, and resolving an
    // ambiguous route by guessing is how a tenant lands on another's dashboard.
    const other = await one<{ id: string }>(
      `insert into orgs (name) values ('Other') returning id`,
    );
    await expect(
      db.query(
        `insert into projects (org_id, domain, slug, topic)
         values ($1, 'other.com', 'mso', 'knives')`,
        [other.id],
      ),
    ).rejects.toThrow();
  });

  it('are required, so a project cannot exist without a route', async () => {
    const other = await one<{ id: string }>(
      `insert into orgs (name) values ('Nameless') returning id`,
    );
    await expect(
      db.query(`insert into projects (org_id, domain, topic) values ($1,'x.com','knives')`, [
        other.id,
      ]),
    ).rejects.toThrow();
  });
});

describe('constraints', () => {
  it('will not record a citation position without a citation', async () => {
    await expect(
      db.query(
        `insert into run_results (run_id, prompt_id, engine, attempt, brand_cited, cited_at_position)
         values ($1, $2, 'openai', 1, false, 3)`,
        [run, prompt],
      ),
    ).rejects.toThrow();
  });

  it('will not record half a follow-up tally', async () => {
    await expect(
      db.query(
        `insert into lift_measurements (action_id, baseline_run_id, action_type, engine,
           baseline_cited, baseline_total, followup_cited)
         values ($1, $2, 'schema', 'openai', 0, 3, 2)`,
        [action, run],
      ),
    ).rejects.toThrow();
  });
});

describe('the job lease', () => {
  it('grants once and refuses the second caller', async () => {
    // The guard that stops a duplicated cron spending a second full budget.
    const first = await one<{ id: string | null }>(
      `select acquire_job_lease($1, 'measure', 900) as id`,
      [project],
    );
    const second = await one<{ id: string | null }>(
      `select acquire_job_lease($1, 'measure', 900) as id`,
      [project],
    );
    expect(first.id).not.toBeNull();
    expect(second.id).toBeNull();
  });

  it('does not block a different job', async () => {
    const row = await one<{ id: string | null }>(
      `select acquire_job_lease($1, 'remeasure', 900) as id`,
      [project],
    );
    expect(row.id).not.toBeNull();
  });

  it('frees the lease on release and records what the run spent', async () => {
    const held = await one<{ id: string }>(
      `select id from job_runs where job = 'measure' and status = 'running'`,
    );
    await db.query(`select release_job_lease($1, 'completed', 42, null)`, [held.id]);

    const next = await one<{ id: string | null }>(
      `select acquire_job_lease($1, 'measure', 900) as id`,
      [project],
    );
    expect(next.id).not.toBeNull();

    const row = await one<{ status: string; calls_spent: number }>(
      `select status, calls_spent from job_runs where id = $1`,
      [held.id],
    );
    expect(row.status).toBe('completed');
    expect(row.calls_spent).toBe(42);
  });

  it('reclaims a lease whose worker died', async () => {
    // Otherwise one crash blocks the job until somebody notices.
    await db.query(
      `update job_runs set lease_until = now() - interval '1 hour'
       where job = 'measure' and status = 'running'`,
    );
    const row = await one<{ id: string | null }>(
      `select acquire_job_lease($1, 'measure', 900) as id`,
      [project],
    );
    expect(row.id).not.toBeNull();

    const dead = await one<{ status: string }>(
      `select status from job_runs where job = 'measure' and status = 'failed'
       order by started_at desc limit 1`,
    );
    expect(dead.status).toBe('failed');
  });
});

describe('connections', () => {
  it('keeps one row per provider, replaced on reconnect', async () => {
    for (const sealed of ['sealed-a', 'sealed-b']) {
      await db.query(
        `insert into connections (project_id, provider, refresh_token_sealed, scope)
         values ($1, 'google_search_console', $2, 'readonly')
         on conflict (project_id, provider)
         do update set refresh_token_sealed = excluded.refresh_token_sealed`,
        [project, sealed],
      );
    }
    const rows = (
      await db.query<{ refresh_token_sealed: string }>(
        `select refresh_token_sealed from connections`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refresh_token_sealed).toBe('sealed-b');
  });
});

describe('cascades', () => {
  it('takes a project’s data with it when the project goes', async () => {
    await db.query(`delete from projects where id = $1`, [project]);
    const row = await one<{ n: string }>(
      `select (select count(*) from prompts) + (select count(*) from actions)
            + (select count(*) from job_runs) + (select count(*) from connections)
            + (select count(*) from refusals) as n`,
    );
    expect(Number(row.n)).toBe(0);
  });
});
