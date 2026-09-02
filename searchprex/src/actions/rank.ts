import type { ActionType } from './types.js';
import type { Certainty } from '../gaps/types.js';

/**
 * Leverage per action type, from the spec's lever table. Higher moves the
 * number more when it works.
 */
const LEVERAGE: Record<ActionType, number> = {
  placement: 5,
  answer_block: 4,
  crawl_fix: 3,
  schema: 2,
  internal_link: 2,
  // Advisory. It carries real information but produces no change on its own,
  // so it must never outrank work that does.
  rank_first: 1,
};

/**
 * Effort, as a divisor. Placement needs a human to pitch and wait; a robots.txt
 * line is a one-minute edit.
 */
const EFFORT: Record<ActionType, number> = {
  crawl_fix: 1,
  schema: 1,
  internal_link: 2,
  answer_block: 3,
  rank_first: 1,
  placement: 5,
};

/**
 * How much we discount a recommendation we cannot prove. This is the number
 * that keeps a plausible lever from being sold beside a proven one.
 */
const CERTAINTY_WEIGHT: Record<Certainty, number> = {
  proven: 1,
  strong: 0.7,
  plausible: 0.4,
};

const PROMPT_VALUE: Record<string, number> = {
  commercial: 3,
  comparison: 2,
  brand: 2,
  informational: 1,
};

export interface RankInput {
  actionType: ActionType;
  certainty: Certainty;
  /** Prompt intent, from the prompt universe. */
  intent?: string;
  /** Share of the customer's AI traffic this engine represents, 0-1. */
  engineWeight?: number;
  /**
   * Observed rate at which this action type produced a citation, from
   * lift_measurements. Defaults to 0.5 — an explicit "we do not know yet"
   * rather than an optimistic guess, so a new action type neither dominates
   * nor is buried before it has a record.
   */
  historicalWinRate?: number;
}

export function priorityFor(input: RankInput): number {
  const leverage = LEVERAGE[input.actionType];
  const effort = EFFORT[input.actionType];
  const certainty = CERTAINTY_WEIGHT[input.certainty];
  const promptValue = PROMPT_VALUE[input.intent ?? 'informational'] ?? 1;
  const engineWeight = clamp(input.engineWeight ?? 1, 0, 1);
  const winRate = clamp(input.historicalWinRate ?? 0.5, 0, 1);

  return (leverage * certainty * promptValue * engineWeight * winRate) / effort;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
