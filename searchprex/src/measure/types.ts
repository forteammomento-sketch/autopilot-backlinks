import type { ActionType } from '../actions/types.js';

export interface Tally {
  /** Attempts in which the brand was cited. */
  cited: number;
  /** Attempts that returned an answer at all. */
  total: number;
}

/**
 * One prompt/engine pair being tracked from a deploy through to its follow-up.
 */
export interface PendingRemeasure {
  actionId: string;
  actionType: ActionType;
  prompt: string;
  engine: string;
  targetUrl: string | null;
  /** Marker id for an answer block, so we can confirm it went live. */
  blockId?: string;
  /** ISO timestamp of the deploy. */
  deployedAt: string;
  baseline: Tally;
  /** True when nothing was deployed for this prompt — the control group. */
  isControl?: boolean;
}

export type LiftDirection = 'gained' | 'improved' | 'unchanged' | 'declined' | 'lost';

export interface LiftRecord {
  actionId: string;
  actionType: ActionType;
  prompt: string;
  engine: string;
  baseline: Tally;
  followup: Tally;
  direction: LiftDirection;
  /**
   * True only for a complete flip — every attempt to none, or none to every.
   *
   * With three attempts per side, nothing weaker than that survives a
   * significance test on its own. Marking a 0/3 to 2/3 move "confident" would
   * be the single most misleading number this product could print, so the flag
   * exists to stop the UI doing it.
   */
  confident: boolean;
  isControl: boolean;
  measuredAt: string;
}

export type RemeasureOutcome =
  | { kind: 'measured'; record: LiftRecord }
  | { kind: 'not_due'; pending: PendingRemeasure; dueAt: string }
  | { kind: 'not_live'; pending: PendingRemeasure; reason: string }
  | { kind: 'failed'; pending: PendingRemeasure; reason: string };
