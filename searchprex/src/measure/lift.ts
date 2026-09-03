import type { LiftDirection, LiftRecord, PendingRemeasure, Tally } from './types.js';

export function rate(tally: Tally): number {
  return tally.total === 0 ? 0 : tally.cited / tally.total;
}

export function directionOf(baseline: Tally, followup: Tally): LiftDirection {
  const before = rate(baseline);
  const after = rate(followup);

  if (before === 0 && after === 1) return 'gained';
  if (before === 1 && after === 0) return 'lost';
  if (after > before) return 'improved';
  if (after < before) return 'declined';
  return 'unchanged';
}

/**
 * Whether this single comparison can carry a claim on its own.
 *
 * It almost never can. With three attempts either side, a move from 0/3 to 2/3
 * has a Fisher exact p of roughly 0.4 — indistinguishable from the engine
 * answering differently on the day. Even 0/3 to 3/3 only reaches about 0.1.
 *
 * So no per-prompt result here is significant in the statistical sense, and
 * this flag marks only the complete flips: the cases where the raw numbers are
 * at least unambiguous about which way things moved. Everything else is
 * directional evidence that belongs in an aggregate, never in a headline.
 */
export function isConfident(baseline: Tally, followup: Tally): boolean {
  if (baseline.total === 0 || followup.total === 0) return false;
  const before = rate(baseline);
  const after = rate(followup);
  return (before === 0 && after === 1) || (before === 1 && after === 0);
}

export function toLiftRecord(
  pending: PendingRemeasure,
  followup: Tally,
  measuredAt: string,
): LiftRecord {
  return {
    actionId: pending.actionId,
    actionType: pending.actionType,
    prompt: pending.prompt,
    engine: pending.engine,
    baseline: pending.baseline,
    followup,
    direction: directionOf(pending.baseline, followup),
    confident: isConfident(pending.baseline, followup),
    isControl: pending.isControl === true,
    measuredAt,
  };
}

export interface CohortLift {
  treatedCount: number;
  controlCount: number;
  /** Mean change in citation rate among prompts we acted on. */
  treatedDelta: number;
  /** Mean change among prompts we did not touch. */
  controlDelta: number;
  /**
   * `treatedDelta - controlDelta`. This is the number worth reporting.
   *
   * Between a baseline and a follow-up two weeks later, the engines retrain,
   * reindex and reword; the customer's competitors publish; the site changes
   * for unrelated reasons. A raw before/after cannot separate our work from any
   * of that. Prompts with no action deployed ride the same drift, so
   * subtracting their movement is what turns a suggestive chart into evidence.
   */
  netLift: number;
  /**
   * False when there is no usable control group. The UI must then present the
   * treated delta as "changed", never as "we caused".
   */
  hasControl: boolean;
}

export function cohortLift(records: LiftRecord[]): CohortLift {
  const treated = records.filter((r) => !r.isControl);
  const control = records.filter((r) => r.isControl);

  const treatedDelta = meanDelta(treated);
  const controlDelta = meanDelta(control);

  return {
    treatedCount: treated.length,
    controlCount: control.length,
    treatedDelta,
    controlDelta,
    netLift: control.length === 0 ? treatedDelta : treatedDelta - controlDelta,
    hasControl: control.length > 0,
  };
}

function meanDelta(records: LiftRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => sum + (rate(r.followup) - rate(r.baseline)), 0);
  return total / records.length;
}
