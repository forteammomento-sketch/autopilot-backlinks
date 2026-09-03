import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { crawlSite } from '@/src/crawl/crawl';
import { generatePrompts as generatePromptSet } from '@/src/prompts/generate';
import { OpenAIPromptWriter } from '@/src/prompts/openai-writer';
import { mergeSeeds, seedsFromCrawl, seedsFromSearchConsole } from '@/src/prompts/seeds';
import { searchConsoleFromEnv } from '@/lib/gsc/from-env';
import {
  deleteConnection,
  listProperties,
  readConnection,
  searchConsoleForProject,
  setConnectionSite,
} from '@/lib/gsc/connection';
import { buildDeployPlan, staticSiteResolver } from '@/src/deploy/plan';
import { deployViaPullRequest, rollbackViaPullRequest } from '@/src/deploy/github';
import { RestGitHubClient } from '@/src/deploy/rest-client';
import { applyShopifyPlan, buildShopifyPlan, rollbackShopifyDeploy } from '@/src/deploy/shopify';
import { RestShopifyClient } from '@/src/deploy/shopify-client';
import type { Action, ActionArtifact } from '@/src/actions/types';
import type { Certainty, GapType } from '@/src/gaps/types';
import type {
  ActionRow,
  CohortSummary,
  DataSource,
  DeployOutcome,
  MutationResult,
  MutationSource,
  PlacementRow,
  ProjectSummary,
  PromptRow,
  ProofRow,
  RefusalRow,
  GscConnection,
  GscProperty,
  PromptGenerationOutcome,
  RollbackOutcome,
  Verdict,
} from '@/lib/data/types';

/**
 * Supabase-backed data source.
 *
 * Reads views, not tables — see migration 0003. A screen should not have to
 * know that a prompt's text lives two joins from the action addressing it, and
 * keeping the joins in SQL means the query plan is tuned in one place.
 *
 * The service-role key is used, so RLS is bypassed. Every query therefore
 * filters by `project_id` explicitly: the guard has to live here, and losing it
 * would leak one customer's queue into another's dashboard.
 */
export function createSupabaseData(client: SupabaseClient, projectId: string): DataSource {
  return {
    project: async (): Promise<ProjectSummary | null> => {
      const { data, error } = await client
        .from('v_project_summary')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();
      if (error !== null || data === null) return null;

      return {
        slug: projectId,
        name: String(data['domain']),
        domain: String(data['domain']),
        topic: String(data['topic']),
        lastRunAt: String(data['last_run_at'] ?? new Date().toISOString()),
        citationsGained: Number(data['citations_gained'] ?? 0),
        promptCount: Number(data['prompt_count'] ?? 0),
        engines: (data['engines'] as string[] | null) ?? [],
        cmsKind: (data['cms_kind'] as ProjectSummary['cmsKind']) ?? null,
      };
    },

    prompts: async (): Promise<PromptRow[]> => {
      const { data } = await client
        .from('v_prompt_visibility')
        .select('*')
        .eq('project_id', projectId);

      // One row per prompt/engine; the screen wants one row per prompt.
      const byPrompt = new Map<string, PromptRow>();
      for (const row of data ?? []) {
        const id = String(row['prompt_id']);
        const existing = byPrompt.get(id) ?? {
          id,
          text: String(row['prompt']),
          intent: row['intent'] as PromptRow['intent'],
          cluster: String(row['cluster']),
          engines: [],
          rivals: [],
        };
        existing.engines.push({
          engine: String(row['engine']),
          verdict: row['verdict'] as Verdict,
          cited: Number(row['cited'] ?? 0),
          total: Number(row['total'] ?? 0),
        });
        for (const rival of (row['rivals'] as string[] | null) ?? []) {
          if (!existing.rivals.includes(rival)) existing.rivals.push(rival);
        }
        byPrompt.set(id, existing);
      }
      return [...byPrompt.values()];
    },

    actions: async (): Promise<ActionRow[]> => {
      const { data } = await client
        .from('v_action_queue')
        .select('*')
        .eq('project_id', projectId)
        .order('priority', { ascending: false });

      return (data ?? []).map(toActionRow);
    },

    refusals: async (): Promise<RefusalRow[]> => {
      const { data } = await client.from('v_refusals').select('*').eq('project_id', projectId);
      return (data ?? []).map((row) => ({
        id: String(row['id']),
        actionType: row['action_type'] as ActionRow['actionType'],
        reason: row['reason'] as RefusalRow['reason'],
        prompt: String(row['prompt']),
        engine: String(row['engine']),
        needed: String(row['needed']),
      }));
    },

    placements: async (): Promise<PlacementRow[]> => {
      const { data } = await client
        .from('v_placements')
        .select('*')
        .eq('project_id', projectId)
        .order('citation_count', { ascending: false });

      return (data ?? []).map((row) => ({
        domain: String(row['domain']),
        promptsCovered: Number(row['prompts_covered'] ?? 0),
        citationCount: Number(row['citation_count'] ?? 0),
        rivalPresent: row['rival_present'] === true,
        examplePrompt: String(row['example_prompt'] ?? ''),
      }));
    },

    proof: async (): Promise<ProofRow[]> => {
      const { data } = await client.from('v_proof').select('*').eq('project_id', projectId);

      // One row per lift measurement; the screen groups them by action.
      const byAction = new Map<string, ProofRow>();
      for (const row of data ?? []) {
        const key = `${String(row['prompt'])}::${String(row['action_type'])}`;
        const existing = byAction.get(key) ?? {
          id: String(row['id']),
          actionType: row['action_type'] as ActionRow['actionType'],
          prompt: String(row['prompt']),
          deployedAt: String(row['deployed_at'] ?? ''),
          measuredAt: row['measured_at'] === null ? null : String(row['measured_at']),
          engines: [],
          isControl: row['is_control'] === true,
          deferredReason: row['deferred_reason'] === null ? null : String(row['deferred_reason']),
        };
        existing.engines.push({
          engine: String(row['engine']),
          before: { cited: Number(row['baseline_cited']), total: Number(row['baseline_total']) },
          after:
            row['followup_total'] === null
              ? null
              : { cited: Number(row['followup_cited']), total: Number(row['followup_total']) },
          direction: (row['direction'] as ProofRow['engines'][number]['direction']) ?? null,
          confident: row['confident'] === true,
        });
        byAction.set(key, existing);
      }
      return [...byAction.values()];
    },

    cohort: async (): Promise<CohortSummary> => {
      const { data } = await client
        .from('v_proof')
        .select('is_control, baseline_cited, baseline_total, followup_cited, followup_total')
        .eq('project_id', projectId);

      const rows = (data ?? []).filter((r) => r['followup_total'] !== null);
      const delta = (r: Record<string, unknown>): number =>
        Number(r['followup_cited']) / Math.max(1, Number(r['followup_total'])) -
        Number(r['baseline_cited']) / Math.max(1, Number(r['baseline_total']));

      const treated = rows.filter((r) => r['is_control'] !== true);
      const control = rows.filter((r) => r['is_control'] === true);
      const mean = (list: typeof rows): number =>
        list.length === 0 ? 0 : list.reduce((sum, r) => sum + delta(r), 0) / list.length;

      const treatedDelta = mean(treated);
      const controlDelta = mean(control);

      return {
        treatedCount: treated.length,
        controlCount: control.length,
        treatedDelta,
        controlDelta,
        netLift: control.length === 0 ? treatedDelta : treatedDelta - controlDelta,
        hasControl: control.length > 0,
      };
    },

    connection: async (): Promise<GscConnection | null> =>
      readConnection(client, projectId),

    properties: async (): Promise<GscProperty[]> => {
      try {
        return await listProperties(client, projectId);
      } catch {
        // A revoked or expired grant should read as "reconnect", not as a
        // crash on the settings page.
        return [];
      }
    },
  };
}

function toActionRow(row: Record<string, unknown>): ActionRow {
  const artifact = (row['artifact'] as ActionArtifact | null) ?? null;
  return {
    id: String(row['id']),
    actionType: row['action_type'] as ActionRow['actionType'],
    gapType: (row['gap_type'] as GapType) ?? 'weak_passage',
    gate: (Number(row['gate'] ?? 3) as ActionRow['gate']) ?? 3,
    prompt: String(row['prompt'] ?? ''),
    engine: String(row['engine'] ?? ''),
    targetUrl: row['target_url'] === null ? null : String(row['target_url']),
    priority: Number(row['priority'] ?? 0),
    certainty: (row['certainty'] as Certainty) ?? 'plausible',
    rationale: String(row['rationale'] ?? ''),
    status: row['status'] as ActionRow['status'],
    preview: artifact === null ? null : previewOf(artifact),
  };
}

function previewOf(artifact: ActionArtifact): { label: string; body: string } {
  switch (artifact.kind) {
    case 'answer_block':
      return { label: 'Generated block', body: artifact.html };
    case 'schema':
      return { label: 'JSON-LD', body: JSON.stringify(artifact.jsonLd, null, 2) };
    case 'crawl_fix':
      return {
        label: artifact.layer === 'edge' ? 'Edge change required' : 'robots.txt addition',
        body: artifact.robotsAdditions.length > 0 ? artifact.robotsAdditions.join('\n') : artifact.note,
      };
    case 'internal_link':
      return {
        label: 'Suggested links',
        body: artifact.sourceUrls
          .map((url) => `From ${url} → anchor "${artifact.anchors[0] ?? ''}"`)
          .join('\n'),
      };
    case 'placement':
      return {
        label: 'Placement targets',
        body: artifact.targets.map((t) => t.domain).join(' · '),
      };
  }
}

/* ── mutations ─────────────────────────────────────────────────────────────── */

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export interface ShopifyConfig {
  shop: string;
  accessToken: string;
}

export function createSupabaseMutations(
  client: SupabaseClient,
  projectId: string,
  github: GitHubConfig | null,
  shopify: ShopifyConfig | null = null,
): MutationSource {
  /**
   * Every transition is guarded by the current status in the `where` clause
   * rather than read-then-write. Two people clicking Approve at once, or a
   * double-submitted form, then resolves to one update and one no-op instead of
   * two conflicting writes.
   */
  const transition = async (
    actionId: string,
    from: string[],
    to: string,
    failure: string,
  ): Promise<MutationResult> => {
    const { data, error } = await client
      .from('actions')
      .update({ status: to })
      .eq('id', actionId)
      .eq('project_id', projectId)
      .in('status', from)
      .select('id');

    if (error !== null) return { ok: false, message: error.message };
    if (data === null || data.length === 0) return { ok: false, message: failure };
    return { ok: true };
  };

  return {
    approve: (actionId) =>
      transition(actionId, ['draft'], 'approved', 'Only a draft action can be approved.'),

    unapprove: (actionId) =>
      transition(actionId, ['approved'], 'draft', 'Only an approved action can be taken back.'),

    reject: (actionId) =>
      transition(
        actionId,
        ['draft', 'approved'],
        'rejected',
        'This is already deployed — roll it back instead.',
      ),

    /**
     * Crawl for seeds, generate, save.
     *
     * The crawl runs inline. This is a setup action taken once, not something
     * on a request path, and seeding from a live crawl is what keeps the set
     * about products the site actually stocks — the alternative, generating
     * from the topic alone, produces questions that can never be won.
     */
    chooseProperty: async (siteUrl): Promise<MutationResult> => {
      await setConnectionSite(client, projectId, siteUrl);
      return { ok: true };
    },

    disconnectGoogle: async (): Promise<MutationResult> => {
      await deleteConnection(client, projectId);
      return { ok: true };
    },

    generatePrompts: async (): Promise<PromptGenerationOutcome> => {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (apiKey === undefined || apiKey === '') {
        return {
          kind: 'unconfigured',
          why: 'Prompt generation needs OPENAI_API_KEY. Nothing was generated.',
        };
      }

      try {
        const { data: project } = await client
          .from('projects')
          .select('domain, topic, brand_names')
          .eq('id', projectId)
          .maybeSingle();
        if (project === null) return { kind: 'error', message: 'project not found' };

        const brandAliases = (project['brand_names'] as string[] | null) ?? [];

        // Search Console first: measured demand on pages that already rank
        // somewhere, which gives a prompt a chance at gate 2 that an invented
        // one does not. A project without it still generates, from the
        // catalogue — that is inferred demand rather than measured, and worth
        // less, but it is not nothing.
        // A connection made through the consent flow wins over environment
        // variables: it is the one the customer can see and revoke.
        const gsc = (await searchConsoleForProject(client, projectId)) ?? searchConsoleFromEnv();
        const gscSeeds =
          gsc === null
            ? []
            : seedsFromSearchConsole(await gsc.queries({ limit: 500 }), 40, {
                brandAliases,
                minImpressions: 5,
              });

        const index = await crawlSite(String(project['domain']), { maxPages: 40 });
        if (!index.reachable && gscSeeds.length === 0) {
          return {
            kind: 'error',
            message:
              `Could not reach ${String(project['domain'])}, and Search Console is not ` +
              'connected. With no seeds from either, generating would ask about products ' +
              'the site may not stock.',
          };
        }

        const seeds = mergeSeeds(gscSeeds, index.reachable ? seedsFromCrawl(index) : []);
        if (seeds.length === 0) {
          return {
            kind: 'error',
            message:
              'No product or category pages were found to seed from. Prompt generation ' +
              'needs real inventory to work from.',
          };
        }

        const { data: existing } = await client
          .from('prompts')
          .select('text')
          .eq('project_id', projectId);

        const report = await generatePromptSet(
          seeds,
          { topic: String(project['topic']), brandAliases },
          new OpenAIPromptWriter({ apiKey }),
          { existing: (existing ?? []).map((row) => String(row['text'])) },
        );

        if (report.prompts.length > 0) {
          const { error } = await client.from('prompts').insert(
            report.prompts.map((p) => ({
              project_id: projectId,
              text: p.text,
              intent: p.intent,
              cluster: p.cluster,
              source: 'generated',
            })),
          );
          if (error !== null) return { kind: 'error', message: error.message };
        }

        return {
          kind: 'generated',
          prompts: report.prompts.map((p) => ({
            text: p.text,
            intent: p.intent,
            cluster: p.cluster,
          })),
          rejected: report.rejected.length,
          weeklyCalls: report.weeklyCallsPerEngine,
        };
      } catch (cause) {
        return { kind: 'error', message: String(cause) };
      }
    },

    rollback: async (actionId): Promise<RollbackOutcome> => {
      const { data: rows, error } = await client
        .from('deployments')
        .select('id, external_ref, before_snapshot, pr_url, pr_number')
        .eq('action_id', actionId)
        .is('rolled_back_at', null);

      if (error !== null) return { kind: 'error', message: error.message };
      if (rows === null || rows.length === 0) {
        return { kind: 'nothing', why: 'No live deployment is recorded for this action.' };
      }
      const { data: project } = await client
        .from('projects')
        .select('cms_kind')
        .eq('id', projectId)
        .maybeSingle();

      if (project?.['cms_kind'] === 'shopify') {
        if (shopify === null) {
          return { kind: 'nothing', why: 'Shopify is not configured, so nothing can be restored.' };
        }
        try {
          await rollbackShopifyDeploy(
            {
              method: 'shopify',
              deployedAt: new Date().toISOString(),
              changes: rows.map((row) => {
                const ref = String(row['external_ref']);
                const [kind, ...rest] = ref.split(':');
                return {
                  kind: kind === 'asset' ? ('asset' as const) : ('product' as const),
                  ref: rest.join(':'),
                  before: String(row['before_snapshot']),
                  actionIds: [actionId],
                };
              }),
            },
            new RestShopifyClient(shopify),
          );

          await client
            .from('deployments')
            .update({ rolled_back_at: new Date().toISOString() })
            .in('id', rows.map((row) => String(row['id'])));
          await client
            .from('actions')
            .update({ status: 'draft' })
            .eq('id', actionId)
            .eq('project_id', projectId);

          return {
            kind: 'restored',
            files: rows.map((row) => String(row['external_ref'])),
            why:
              'The storefront is back to its content from before the deploy. There is no ' +
              'pull request to merge — the restore is already live.',
          };
        } catch (cause) {
          return { kind: 'error', message: String(cause) };
        }
      }

      if (github === null) {
        return {
          kind: 'nothing',
          why: 'GitHub is not configured, so the revert pull request cannot be opened.',
        };
      }

      const gh = new RestGitHubClient(github);

      try {
        const pr = await rollbackViaPullRequest(
          {
            method: 'github_pr',
            branch: `searchprex/${actionId}`,
            baseBranch: await gh.getDefaultBranch(),
            files: rows.map((row) => ({
              path: String(row['external_ref']),
              before: String(row['before_snapshot']),
            })),
            deployedAt: new Date().toISOString(),
          },
          gh,
        );

        // Mark the deployment rolled back before the action moves, so a failure
        // between the two leaves a record that the revert happened rather than
        // an action that looks deployable again with no snapshot behind it.
        await client
          .from('deployments')
          .update({ rolled_back_at: new Date().toISOString() })
          .in('id', rows.map((row) => String(row['id'])));

        await client
          .from('actions')
          .update({ status: 'draft' })
          .eq('id', actionId)
          .eq('project_id', projectId);

        return {
          kind: 'reverted',
          prUrl: pr.url,
          prNumber: pr.number,
          files: rows.map((row) => String(row['external_ref'])),
        };
      } catch (cause) {
        return { kind: 'error', message: String(cause) };
      }
    },

    deployApproved: async (): Promise<DeployOutcome> => {
      const { data, error } = await client
        .from('v_action_queue')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'approved')
        .order('priority', { ascending: false });

      if (error !== null) return { kind: 'error', message: error.message };
      const approved = data ?? [];
      if (approved.length === 0) return { kind: 'nothing', why: 'Nothing is approved yet.' };

      const { data: project } = await client
        .from('projects')
        .select('cms_kind')
        .eq('id', projectId)
        .maybeSingle();

      if (project?.['cms_kind'] === 'shopify') {
        return deployToShopify(client, projectId, approved.map(toCoreAction), shopify);
      }

      if (github === null) {
        return {
          kind: 'nothing',
          why:
            'GitHub is not configured for this project. Set SEARCHPREX_GITHUB_TOKEN, ' +
            '_OWNER and _REPO to open the pull request.',
        };
      }

      const gh = new RestGitHubClient(github);

      try {
        const base = await gh.getDefaultBranch();
        const plan = await buildDeployPlan(approved.map(toCoreAction), {
          resolver: staticSiteResolver(),
          readFile: async (path) => (await gh.getFile(path, base))?.content ?? null,
        });

        if (plan.changes.length === 0) {
          return {
            kind: 'nothing',
            why:
              plan.skipped[0]?.reason ??
              'The approved actions produced no file changes — they may already be live.',
          };
        }

        const record = await deployViaPullRequest(plan, gh, { base });
        if (record === null) return { kind: 'nothing', why: 'The plan was empty.' };

        // Persist the snapshot before marking anything deployed: the snapshot is
        // the rollback, and an action marked deployed with no way back is worse
        // than one that has to be re-approved.
        for (const change of plan.changes) {
          await client.from('deployments').insert({
            action_id: approved[0]!['id'],
            method: 'github_pr',
            before_snapshot: change.before,
            external_ref: change.path,
            pr_number: record.prNumber ?? null,
            pr_url: record.prUrl ?? null,
          });
        }

        await client
          .from('actions')
          .update({ status: 'deployed' })
          .eq('project_id', projectId)
          .in(
            'id',
            approved.map((a) => String(a['id'])),
          );

        return {
          kind: 'opened',
          prUrl: record.prUrl ?? '',
          prNumber: record.prNumber ?? 0,
          files: plan.changes.map((c) => ({
            path: c.path,
            applied: c.applied.map((a) => a.actionType),
          })),
          capped: plan.cappedCount,
        };
      } catch (cause) {
        return { kind: 'error', message: String(cause) };
      }
    },
  };
}

/**
 * Deploy to a live Shopify storefront.
 *
 * The deployment row carrying the rollback snapshot is written *before* the
 * action is marked deployed, and the plan's `before` content is what goes in
 * it. On a git target a bad deploy sits in an unmerged pull request; here it is
 * already on the shop, so the snapshot is the only way back and it has to exist
 * first.
 */
async function deployToShopify(
  client: SupabaseClient,
  projectId: string,
  actions: Action[],
  shopify: ShopifyConfig | null,
): Promise<DeployOutcome> {
  if (shopify === null) {
    return {
      kind: 'nothing',
      why:
        'Shopify is not configured for this project. Set SHOPIFY_SHOP and ' +
        'SHOPIFY_ACCESS_TOKEN to apply approved changes to the storefront.',
    };
  }

  try {
    const store = new RestShopifyClient(shopify);
    const plan = await buildShopifyPlan(actions, store);

    if (plan.changes.length === 0) {
      return {
        kind: 'nothing',
        why:
          plan.skipped[0]?.reason ??
          'The approved actions produced no changes — they may already be live.',
      };
    }

    const record = await applyShopifyPlan(plan, store);

    for (const change of record.changes) {
      // One row per changed product or asset, each pointing at the action that
      // put the content there, so a rollback can reopen exactly that action.
      for (const actionId of change.actionIds) {
        await client.from('deployments').insert({
          action_id: actionId,
          method: 'shopify',
          before_snapshot: change.before,
          external_ref: `${change.kind}:${change.ref}`,
        });
      }
    }

    await client
      .from('actions')
      .update({ status: 'deployed' })
      .eq('project_id', projectId)
      .eq('status', 'approved');

    return {
      kind: 'applied',
      target: shopify.shop,
      files: plan.changes.map((c) => ({
        path: c.kind === 'product' ? `product/${c.handle}` : c.key,
        applied: c.applied.map((a) => a.actionType),
      })),
      capped: plan.cappedCount,
    };
  } catch (cause) {
    return { kind: 'error', message: String(cause) };
  }
}

function toCoreAction(row: Record<string, unknown>): Action {
  const view = toActionRow(row);
  return {
    id: view.id,
    actionType: view.actionType,
    gap: {
      prompt: view.prompt,
      engine: view.engine,
      gapType: view.gapType,
      blockedAtGate: view.gate,
      ourUrl: view.targetUrl,
      rivalUrl: null,
      certainty: view.certainty,
      evidence: { reason: view.rationale },
    },
    targetUrl: view.targetUrl,
    priority: view.priority,
    certainty: view.certainty,
    artifact: (row['artifact'] as ActionArtifact | null) ?? null,
    rationale: view.rationale,
  };
}

export function createSupabaseClient(): SupabaseClient | null {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (url === undefined || key === undefined || url === '' || key === '') return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function shopifyConfigFromEnv(): ShopifyConfig | null {
  const shop = process.env['SHOPIFY_SHOP'];
  const accessToken = process.env['SHOPIFY_ACCESS_TOKEN'];
  if (!shop || !accessToken) return null;
  return { shop, accessToken };
}

export function githubConfigFromEnv(): GitHubConfig | null {
  const token = process.env['SEARCHPREX_GITHUB_TOKEN'];
  const owner = process.env['SEARCHPREX_GITHUB_OWNER'];
  const repo = process.env['SEARCHPREX_GITHUB_REPO'];
  if (!token || !owner || !repo) return null;
  return { token, owner, repo };
}
