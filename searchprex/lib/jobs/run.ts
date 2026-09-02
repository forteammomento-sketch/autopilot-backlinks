import { CallBudget } from '@/src/jobs/budget';
import { estimateCalls, runMeasurement } from '@/src/jobs/measure';
import { PerplexityAdapter } from '@/src/engines/perplexity';
import { OpenAIAdapter } from '@/src/engines/openai';
import { runRemeasure } from '@/src/measure/remeasure';
import type { EngineAdapter } from '@/src/engines/types';
import type { JobPrompt } from '@/src/jobs/types';
import type { ProjectContext } from '@/src/lib/citations';
import type { PendingRemeasure } from '@/src/measure/types';
import { createSupabaseClient } from '@/lib/data/supabase';
import { acquireLease } from '@/lib/jobs/lease';

export type JobName = 'measure' | 'remeasure';

export type JobOutcome =
  | { kind: 'ran'; job: JobName; status: string; callsSpent: number; measured: number; skipped: number }
  | { kind: 'busy'; job: JobName; why: string }
  | { kind: 'unconfigured'; why: string }
  | { kind: 'failed'; job: JobName; error: string };

/** Ceiling per run. Sized so a 60-prompt, 2-engine, 3-repeat run fits with room. */
const DEFAULT_BUDGET = Number(process.env['SEARCHPREX_CALL_BUDGET'] ?? '600');
const LEASE_TTL_SECONDS = 900;

export async function runJob(job: JobName): Promise<JobOutcome> {
  const client = createSupabaseClient();
  const projectId = process.env['SEARCHPREX_PROJECT_ID'] ?? '';

  if (client === null || projectId === '') {
    return {
      kind: 'unconfigured',
      why: 'Jobs need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEARCHPREX_PROJECT_ID.',
    };
  }

  const adapters = buildAdapters();
  if (Object.keys(adapters).length === 0) {
    return { kind: 'unconfigured', why: 'No engine API keys are configured.' };
  }

  const lease = await acquireLease(client, projectId, job, LEASE_TTL_SECONDS);
  if (lease === null) {
    return { kind: 'busy', job, why: 'Another run of this job is already in flight.' };
  }

  const budget = new CallBudget(DEFAULT_BUDGET);

  try {
    const context = await loadContext(client, projectId);
    if (context === null) throw new Error('project not found');

    const outcome =
      job === 'measure'
        ? await measure(client, projectId, context, adapters, budget)
        : await remeasure(client, projectId, context, adapters);

    await lease.release(outcome.status, budget.spent, null);
    return { kind: 'ran', job, ...outcome, callsSpent: budget.spent };
  } catch (cause) {
    const message = String(cause);
    // The lease is released on the failure path too. A crashed run that keeps
    // its lease blocks the job until the TTL expires, which for a daily
    // schedule means a whole day of no measurement.
    await lease.release('failed', budget.spent, message.slice(0, 500));
    return { kind: 'failed', job, error: message };
  }
}

async function measure(
  client: ReturnType<typeof createSupabaseClient> & object,
  projectId: string,
  context: ProjectContext,
  adapters: Record<string, EngineAdapter>,
  budget: CallBudget,
): Promise<{ status: string; measured: number; skipped: number }> {
  const { data } = await client
    .from('prompts')
    .select('id, text, intent')
    .eq('project_id', projectId)
    .eq('is_active', true);

  const prompts: JobPrompt[] = (data ?? []).map((row) => ({
    id: String(row['id']),
    text: String(row['text']),
    intent: String(row['intent']),
  }));

  if (prompts.length === 0) return { status: 'completed', measured: 0, skipped: 0 };

  const wanted = estimateCalls(prompts.length, Object.keys(adapters).length);
  if (wanted > budget.limit) {
    // Not an error — the run proceeds and stops at the ceiling, and the skipped
    // rows say what is still owed. Silently measuring a subset without saying
    // so is what turns a partial run into a wrong dashboard.
    console.warn(
      `[searchprex] this run needs ${String(wanted)} calls but the budget is ` +
        `${String(budget.limit)}; the remainder will be reported as skipped`,
    );
  }

  const { data: runRow } = await client
    .from('runs')
    .insert({ project_id: projectId, kind: 'scheduled' })
    .select('id')
    .single();
  const runId = runRow === null ? null : String(runRow['id']);

  const run = await runMeasurement(prompts, budget, {
    adapters,
    context,
    onResult: async (result) => {
      if (runId === null) return;
      for (const [index, attempt] of result.attempts.entries()) {
        await client.from('run_results').insert({
          run_id: runId,
          prompt_id: result.promptId,
          engine: result.engine,
          attempt: index + 1,
          answered: attempt.result?.answered ?? false,
          answer_text: attempt.result?.answerText ?? null,
          brand_mentioned: attempt.analysis?.brandMentioned ?? false,
          brand_cited: attempt.analysis?.brandCited ?? false,
          cited_at_position: attempt.analysis?.citedAtPosition ?? null,
          first_mention_offset: attempt.analysis?.firstMentionOffset ?? null,
          served_by: attempt.result?.servedBy ?? null,
          latency_ms: attempt.result?.latencyMs ?? null,
          error_kind: attempt.error?.kind ?? null,
          error_message: attempt.error?.message ?? null,
        });
      }
    },
  });

  if (runId !== null) {
    await client.from('runs').update({ finished_at: new Date().toISOString() }).eq('id', runId);
  }

  return { status: run.status, measured: run.results.length, skipped: run.skipped.length };
}

async function remeasure(
  client: ReturnType<typeof createSupabaseClient> & object,
  projectId: string,
  context: ProjectContext,
  adapters: Record<string, EngineAdapter>,
): Promise<{ status: string; measured: number; skipped: number }> {
  const { data } = await client
    .from('lift_measurements')
    .select('id, action_id, action_type, prompt_id, engine, baseline_cited, baseline_total')
    .is('followup_total', null);

  const pending: PendingRemeasure[] = (data ?? []).map((row) => ({
    actionId: String(row['action_id']),
    actionType: row['action_type'] as PendingRemeasure['actionType'],
    prompt: '',
    engine: String(row['engine']),
    targetUrl: null,
    deployedAt: new Date().toISOString(),
    baseline: { cited: Number(row['baseline_cited']), total: Number(row['baseline_total']) },
  }));

  const outcomes = await runRemeasure(pending, {
    adapters,
    context,
    fetchPage: async () => null,
  });

  for (const outcome of outcomes) {
    if (outcome.kind !== 'measured') continue;
    await client
      .from('lift_measurements')
      .update({
        followup_cited: outcome.record.followup.cited,
        followup_total: outcome.record.followup.total,
        direction: outcome.record.direction,
        confident: outcome.record.confident,
        measured_at: outcome.record.measuredAt,
      })
      .eq('action_id', outcome.record.actionId);
  }

  const measured = outcomes.filter((o) => o.kind === 'measured').length;
  return { status: 'completed', measured, skipped: outcomes.length - measured };
}

async function loadContext(
  client: ReturnType<typeof createSupabaseClient> & object,
  projectId: string,
): Promise<ProjectContext | null> {
  const { data: project } = await client
    .from('projects')
    .select('domain, brand_names')
    .eq('id', projectId)
    .maybeSingle();
  if (project === null) return null;

  const { data: rivals } = await client
    .from('competitors')
    .select('domain, brand_names')
    .eq('project_id', projectId);

  return {
    domain: String(project['domain']),
    brandNames: (project['brand_names'] as string[] | null) ?? [],
    competitors: (rivals ?? []).map((row) => ({
      domain: String(row['domain']),
      brandNames: (row['brand_names'] as string[] | null) ?? [],
    })),
  };
}

function buildAdapters(): Record<string, EngineAdapter> {
  const adapters: Record<string, EngineAdapter> = {};

  const perplexity = process.env['PERPLEXITY_API_KEY'];
  if (perplexity !== undefined && perplexity !== '') {
    adapters['perplexity'] = new PerplexityAdapter({ apiKey: perplexity });
  }

  const openai = process.env['OPENAI_API_KEY'];
  if (openai !== undefined && openai !== '') {
    adapters['openai'] = new OpenAIAdapter({ apiKey: openai });
  }

  return adapters;
}
