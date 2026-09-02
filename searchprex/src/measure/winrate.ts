import type { ActionType } from '../actions/types.js';
import type { LiftRecord } from './types.js';
import { rate } from './lift.js';

/** Records below this and an action type has no usable record yet. */
export const MIN_SAMPLE = 20;

export interface WinRate {
  actionType: ActionType;
  sample: number;
  /** Share of deployments that improved the citation rate. */
  winRate: number;
}

/**
 * Observed win rate per action type, for the ranker.
 *
 * Returns nothing for an action type with fewer than `minSample` records. That
 * matters more than it looks: the ranker treats a missing win rate as 0.5 — an
 * explicit "no record yet" — whereas handing it 1.0 off three lucky deploys
 * would push that action type to the top of every customer's queue on evidence
 * that is indistinguishable from chance.
 *
 * Control records are excluded: nothing was deployed for them, so they cannot
 * say anything about whether a deployment works.
 */
export function winRates(
  records: LiftRecord[],
  minSample = MIN_SAMPLE,
): Partial<Record<ActionType, number>> {
  const buckets = new Map<ActionType, LiftRecord[]>();

  for (const record of records) {
    if (record.isControl) continue;
    const bucket = buckets.get(record.actionType) ?? [];
    bucket.push(record);
    buckets.set(record.actionType, bucket);
  }

  const out: Partial<Record<ActionType, number>> = {};
  for (const [actionType, bucket] of buckets) {
    if (bucket.length < minSample) continue;
    const wins = bucket.filter((r) => rate(r.followup) > rate(r.baseline)).length;
    out[actionType] = wins / bucket.length;
  }
  return out;
}

/** The same numbers with their sample sizes, for the UI. */
export function winRateDetail(records: LiftRecord[], minSample = MIN_SAMPLE): WinRate[] {
  const rates = winRates(records, minSample);
  const counts = new Map<ActionType, number>();
  for (const record of records) {
    if (record.isControl) continue;
    counts.set(record.actionType, (counts.get(record.actionType) ?? 0) + 1);
  }

  return [...counts]
    .map(([actionType, sample]) => ({ actionType, sample, winRate: rates[actionType] ?? 0.5 }))
    .sort((a, b) => b.sample - a.sample);
}
