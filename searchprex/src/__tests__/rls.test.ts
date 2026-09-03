import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Row-level security, tested the only way it can be: as a non-superuser.
 *
 * Superusers bypass RLS entirely, so a test that queries as one proves nothing
 * at all — it will pass against a database with no policies whatsoever. Every
 * assertion here runs after `set role`, with `auth.uid()` reading the JWT
 * subject out of a session setting exactly as Supabase defines it.
 *
 * Two tenants are seeded with a full set of rows each, so a leak shows up as a
 * row count rather than as a missing string. An earlier version of this check
 * looked for tenant names in the output and reported four views as safe that
 * were leaking — they simply had no rows for the other tenant to leak.
 */
const MIGRATIONS = 'supabase/migrations';

/** Supabase's own definition: the JWT subject, from a session setting. */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid());
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

/** Everything a tenant owns, so a leak is visible in any of them. */
const TENANT_VIEWS = [
  'v_project_summary',
  'v_prompt_visibility',
  'v_action_queue',
  'v_refusals',
  'v_placements',
  'v_proof',
  'v_connections',
  'prompt_samples',
] as const;

const TENANT_TABLES = [
  'projects',
  'competitors',
  'prompts',
  'runs',
  'run_results',
  'citations',
  'gaps',
  'actions',
  'refusals',
  'deployments',
  'lift_measurements',
  'connections',
  'job_runs',
] as const;

interface Tenant {
  user: string;
  org: string;
  project: string;
}

let db: PGlite;
let alpha: Tenant;
let beta: Tenant;
let stranger: string;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0] as T;
}

/** Run a query as a specific signed-in user, with RLS in force. */
async function asUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec('set role app_user');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function countAs(userId: string, relation: string): Promise<number> {
  const rows = await asUser<{ n: number }>(userId, `select count(*)::int as n from ${relation}`);
  return rows[0]?.n ?? 0;
}

async function seedTenant(name: string, domain: string): Promise<Tenant> {
  const user = (await one<{ id: string }>(`insert into auth.users default values returning id`)).id;
  const org = (await one<{ id: string }>(`insert into orgs (name) values ($1) returning id`, [name]))
    .id;
  await db.query(`insert into org_members (org_id, user_id, role) values ($1,$2,'owner')`, [
    org,
    user,
  ]);
  const project = (
    await one<{ id: string }>(
      `insert into projects (org_id, domain, topic, cms_kind)
       values ($1,$2,'knives','shopify') returning id`,
      [org, domain],
    )
  ).id;

  await db.query(
    `insert into competitors (project_id, domain, brand_names) values ($1,'rival.com','{"Rival"}')`,
    [project],
  );
  const prompt = (
    await one<{ id: string }>(
      `insert into prompts (project_id, text, intent, cluster)
       values ($1,$2,'commercial','knives') returning id`,
      [project, `${name} secret prompt`],
    )
  ).id;
  const run = (
    await one<{ id: string }>(
      `insert into runs (project_id, kind, finished_at) values ($1,'baseline',now()) returning id`,
      [project],
    )
  ).id;
  const rr = (
    await one<{ id: string }>(
      `insert into run_results (run_id, prompt_id, engine, attempt, brand_cited)
       values ($1,$2,'perplexity',1,true) returning id`,
      [run, prompt],
    )
  ).id;
  await db.query(
    `insert into citations (run_result_id, position, url, domain, owner) values
       ($1,1,'https://rival.com/a','rival.com','competitor'),
       ($1,2,'https://reddit.com/a','reddit.com','third_party')`,
    [rr],
  );

  const gap = (
    await one<{ id: string }>(
      `insert into gaps (project_id, prompt_id, engine, gap_type, blocked_at_gate, evidence)
       values ($1,$2,'perplexity','weak_passage',3,'{"reason":"thin"}') returning id`,
      [project, prompt],
    )
  ).id;
  const action = (
    await one<{ id: string }>(
      `insert into actions (project_id, gap_id, action_type, target_url, priority, certainty,
                            rationale, status)
       values ($1,$2,'answer_block',$3,2.0,'proven','because','approved') returning id`,
      [project, gap, `https://${domain}/products/x`],
    )
  ).id;
  await db.query(
    `insert into refusals (project_id, prompt_id, action_type, engine, reason, needed)
     values ($1,$2,'answer_block','perplexity','no_first_party_facts',$3)`,
    [project, prompt, `${name} needs a spec`],
  );
  await db.query(
    `insert into deployments (action_id, method, before_snapshot, pr_number, pr_url)
     values ($1,'github_pr',$2,7,$3)`,
    [action, `<p>${name} before</p>`, `https://github.com/${name}/r/pull/7`],
  );
  await db.query(
    `insert into lift_measurements
       (action_id, baseline_run_id, action_type, prompt_id, engine, baseline_cited,
        baseline_total, followup_cited, followup_total, direction, confident, measured_at)
     values ($1,$2,'answer_block',$3,'perplexity',0,3,3,3,'gained',true,now())`,
    [action, run, prompt],
  );
  await db.query(
    `insert into connections (project_id, provider, refresh_token_sealed, scope, site_url)
     values ($1,'google_search_console',$2,'readonly',$3)`,
    [project, `${name}-SEALED`, `sc-domain:${domain}`],
  );
  await db.query(
    `insert into job_runs (project_id, job, lease_until, status)
     values ($1,'measure', now() + interval '15 min','running')`,
    [project],
  );

  return { user, org, project };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(
      readFileSync(`${MIGRATIONS}/${file}`, 'utf8').replace(
        /create extension if not exists "pgcrypto";/g,
        '',
      ),
    );
  }

  alpha = await seedTenant('Alpha', 'alpha.com');
  beta = await seedTenant('Beta', 'beta.com');
  stranger = (await one<{ id: string }>(`insert into auth.users default values returning id`)).id;

  await db.exec('refresh materialized view placement_targets');
  await db.exec(`
    create role app_user nologin;
    grant usage on schema public to app_user;
    grant select on all tables in schema public to app_user;
    grant insert, update, delete on all tables in schema public to app_user;
  `);
}, 60_000);

describe('tables', () => {
  for (const table of TENANT_TABLES) {
    it(`${table}: each tenant sees only its own rows`, async () => {
      const asAlpha = await countAs(alpha.user, table);
      const asBeta = await countAs(beta.user, table);
      const total = Number((await one<{ n: number }>(`select count(*)::int as n from ${table}`)).n);

      // The strongest formulation: the two tenants partition the table exactly.
      // Any leak makes the halves overlap and the sum exceed the whole.
      expect(asAlpha).toBeGreaterThan(0);
      expect(asBeta).toBeGreaterThan(0);
      expect(asAlpha + asBeta).toBe(total);
    });
  }
});

describe('views', () => {
  for (const view of TENANT_VIEWS) {
    it(`${view}: each tenant sees only its own rows`, async () => {
      // Views run as their owner unless security_invoker is on, which bypasses
      // every table policy underneath. Migration 0007 exists because of this.
      const asAlpha = await asUser(alpha.user, `select * from ${view}`);
      const asBeta = await asUser(beta.user, `select * from ${view}`);
      const total = Number(
        (await one<{ n: number }>(`select count(*)::int as n from ${view}`)).n,
      );

      expect(asAlpha.length).toBeGreaterThan(0);
      expect(asAlpha.length + asBeta.length).toBe(total);
      expect(JSON.stringify(asAlpha)).not.toContain('beta.com');
      expect(JSON.stringify(asAlpha)).not.toContain('Beta');
    });
  }

  it('the materialized view is not reachable by a tenant', async () => {
    // A materialized view carries no policies and cannot carry security_invoker,
    // so the only safe posture is that clients never touch it directly.
    const rows = await asUser(alpha.user, `select * from v_placements`);
    expect(rows.every((r) => String((r as { project_id: string }).project_id) === alpha.project)).toBe(
      true,
    );
  });
});

describe('a user who belongs to no org', () => {
  it('sees nothing at all', async () => {
    for (const relation of [...TENANT_TABLES, ...TENANT_VIEWS]) {
      expect(await countAs(stranger, relation)).toBe(0);
    }
  });

  it('cannot create a project inside someone else’s org', async () => {
    await expect(
      asUser(
        stranger,
        `insert into projects (org_id, domain, topic) values ($1,'stolen.com','x')`,
        [alpha.org],
      ),
    ).rejects.toThrow();
  });
});

describe('writes across tenants', () => {
  it('a tenant cannot add a prompt to another tenant’s project', async () => {
    // The `with check` half of the policy, which is the one people forget.
    await expect(
      asUser(
        beta.user,
        `insert into prompts (project_id, text, intent) values ($1,'injected','commercial')`,
        [alpha.project],
      ),
    ).rejects.toThrow();
  });

  it('a tenant cannot move its own project into another org', async () => {
    await expect(
      asUser(alpha.user, `update projects set org_id = $1 where id = $2`, [beta.org, alpha.project]),
    ).rejects.toThrow();
  });

  it('a tenant cannot delete another tenant’s action', async () => {
    const before = await countAs(beta.user, 'actions');
    await asUser(alpha.user, `delete from actions where project_id = $1`, [beta.project]);
    expect(await countAs(beta.user, 'actions')).toBe(before);
  });
});

describe('current_org_ids', () => {
  it('does not recurse through org_members own policy', async () => {
    // The function is security definer precisely so the policy on org_members
    // can call it without re-entering itself.
    const rows = await asUser<{ id: string }>(alpha.user, `select * from current_org_ids() as id`);
    expect(rows.map((r) => r.id)).toEqual([alpha.org]);
  });
});
