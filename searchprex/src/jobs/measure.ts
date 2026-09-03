import { samplePrompt, type SampledPrompt } from '../runner/sample.js';
import { CallBudget } from './budget.js';
import type { JobPrompt, MeasurementDeps, MeasurementRun } from './types.js';

/**
 * Measure a prompt set across engines.
 *
 * Ordering matters: prompts are walked in the order given, and for each prompt
 * every engine is measured before moving on. If the budget runs out mid-run the
 * result is a set of prompts fully measured across all engines rather than
 * every prompt measured on one engine — the first is a usable, if smaller,
 * picture; the second cannot be compared against anything.
 */
export async function runMeasurement(
  prompts: JobPrompt[],
  budget: CallBudget,
  deps: MeasurementDeps,
): Promise<MeasurementRun> {
  const repeats = deps.repeats ?? 3;
  const engines = Object.keys(deps.adapters);
  const startedAt = new Date().toISOString();

  const results: (SampledPrompt & { promptId: string })[] = [];
  const skipped: MeasurementRun['skipped'] = [];
  let status: MeasurementRun['status'] = 'completed';

  outer: for (const prompt of prompts) {
    for (const engine of engines) {
      if (deps.signal?.aborted === true) {
        status = 'cancelled';
        skipped.push({ promptId: prompt.id, engine, reason: 'run cancelled' });
        break outer;
      }

      // Reserve the whole repeat set up front. Measuring a prompt once and then
      // stopping would record a 1-attempt sample, which reads as a verdict but
      // is not one.
      if (!budget.take(repeats)) {
        status = 'budget_exhausted';
        skipped.push({
          promptId: prompt.id,
          engine,
          reason: `call budget of ${String(budget.limit)} reached`,
        });
        break outer;
      }

      const adapter = deps.adapters[engine]!;
      const sampled = await samplePrompt(adapter, prompt.text, deps.context, {
        repeats,
        ...(deps.locale === undefined ? {} : { locale: deps.locale }),
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
        ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      });

      const result = { ...sampled, promptId: prompt.id };
      results.push(result);
      // Persist as we go: a run that dies at prompt 40 of 60 should keep the
      // first 39, not throw the whole thing away.
      if (deps.onResult !== undefined) await deps.onResult(result);
    }
  }

  // Anything the break skipped is still owed a row, so the caller can schedule
  // the remainder rather than silently losing it.
  if (status !== 'completed') {
    const measured = new Set(results.map((r) => `${r.promptId}::${r.engine}`));
    for (const prompt of prompts) {
      for (const engine of engines) {
        const key = `${prompt.id}::${engine}`;
        if (measured.has(key) || skipped.some((s) => `${s.promptId}::${s.engine}` === key)) continue;
        skipped.push({ promptId: prompt.id, engine, reason: 'not reached before the run stopped' });
      }
    }
  }

  return {
    status,
    results,
    callsSpent: budget.spent,
    skipped,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Calls a full run would cost, for the caller to check against its budget
 * before spending anything.
 */
export function estimateCalls(
  promptCount: number,
  engineCount: number,
  repeats = 3,
): number {
  return promptCount * engineCount * repeats;
}
