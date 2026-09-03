import type { EngineAdapter } from '../engines/types.js';
import type { ProjectContext } from '../lib/citations.js';
import { samplePrompt, type SampleOptions } from '../runner/sample.js';
import { toLiftRecord } from './lift.js';
import type { PendingRemeasure, RemeasureOutcome, Tally } from './types.js';
import { verifyDeployed, type VerifySources } from './verify.js';

/** Days between a deploy and its follow-up measurement. */
export const DEFAULT_WAIT_DAYS = 14;

export interface RemeasureDeps extends VerifySources {
  /** Engine adapters by key. A pending row whose engine is missing fails. */
  adapters: Record<string, EngineAdapter>;
  context: ProjectContext;
  now?: () => Date;
  waitDays?: number;
  sampleOptions?: SampleOptions;
}

export function dueAt(pending: PendingRemeasure, waitDays = DEFAULT_WAIT_DAYS): Date {
  const deployed = new Date(pending.deployedAt);
  return new Date(deployed.getTime() + waitDays * 24 * 60 * 60 * 1_000);
}

export function isDue(
  pending: PendingRemeasure,
  now: Date,
  waitDays = DEFAULT_WAIT_DAYS,
): boolean {
  return now.getTime() >= dueAt(pending, waitDays).getTime();
}

/**
 * Re-run the prompts behind deployed actions and record what moved.
 *
 * The order of the guards is the point. A pending row is only measured once it
 * is due **and** the change is confirmed live **and** the engine actually
 * answered. Each guard exists because skipping it writes a wrong number into
 * the evidence base that trains the ranker:
 *
 * - measuring early credits or blames a change the index has not seen;
 * - measuring an unmerged pull request records a loss for work never shipped;
 * - measuring a failed engine call records a loss for an outage.
 *
 * None of these produce a record. They reschedule, which is the only honest
 * thing to do with a measurement that did not happen.
 */
export async function runRemeasure(
  pending: PendingRemeasure[],
  deps: RemeasureDeps,
): Promise<RemeasureOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const waitDays = deps.waitDays ?? DEFAULT_WAIT_DAYS;
  const outcomes: RemeasureOutcome[] = [];

  for (const row of pending) {
    if (!isDue(row, now, waitDays)) {
      outcomes.push({ kind: 'not_due', pending: row, dueAt: dueAt(row, waitDays).toISOString() });
      continue;
    }

    const adapter = deps.adapters[row.engine];
    if (adapter === undefined) {
      outcomes.push({
        kind: 'failed',
        pending: row,
        reason: `no adapter configured for ${row.engine}`,
      });
      continue;
    }

    const live = await verifyDeployed(row, deps);
    if (!live.live) {
      outcomes.push({ kind: 'not_live', pending: row, reason: live.reason });
      continue;
    }

    const sampled = await samplePrompt(adapter, row.prompt, deps.context, deps.sampleOptions ?? {});

    if (sampled.succeeded === 0) {
      outcomes.push({
        kind: 'failed',
        pending: row,
        reason: 'every engine call failed — an outage is not a measurement',
      });
      continue;
    }

    const followup: Tally = { cited: sampled.citedCount, total: sampled.succeeded };
    outcomes.push({
      kind: 'measured',
      record: toLiftRecord(row, followup, now.toISOString()),
    });
  }

  return outcomes;
}

/** Rows that did not produce a record and should be tried again later. */
export function toRetry(outcomes: RemeasureOutcome[]): PendingRemeasure[] {
  return outcomes.flatMap((outcome) => (outcome.kind === 'measured' ? [] : [outcome.pending]));
}
