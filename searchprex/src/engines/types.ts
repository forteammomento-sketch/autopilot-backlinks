/**
 * The engine adapter contract.
 *
 * Every answer engine — Perplexity, ChatGPT search, Gemini, AI Overviews via a
 * SERP vendor — reduces to: given a prompt, return the answer text and the
 * ordered list of sources the engine cited.
 *
 * Two rules hold for every implementation:
 *
 * 1. One call per `query()`. The 3x repeat that handles answer non-determinism
 *    lives in the runner, not in the adapter, so the runner can schedule,
 *    rate-limit and cost-account each call individually.
 * 2. `raw` is returned untouched and gets archived to storage. Engines change
 *    their response shape without notice; keeping the raw payload is what makes
 *    historical runs re-parseable after an adapter rewrite.
 */

export type EngineKey = 'perplexity' | 'openai' | 'gemini' | 'aio' | 'copilot';

export interface EngineCitation {
  /** 1-based, in the order the engine returned them. */
  position: number;
  url: string;
  title?: string;
  /** Publication date when the engine reports one, ISO-8601. */
  date?: string;
}

export interface EngineResult {
  engine: EngineKey;
  /**
   * `false` when the engine ran but produced no answer surface for this prompt.
   * AI Overviews frequently does not fire — that is a distinct state from "the
   * brand was not cited" and conflating them corrupts the visibility numbers.
   */
  answered: boolean;
  answerText: string;
  citations: EngineCitation[];
  /** Model or endpoint that actually served this call, for audit. */
  servedBy: string;
  latencyMs: number;
  /** Untouched provider payload. Archived, never parsed downstream. */
  raw: unknown;
}

export interface QueryOptions {
  /** BCP-47, e.g. `en-US`. Adapters map this to their own locale controls. */
  locale?: string;
  /** Hard ceiling for the call. The runner treats a timeout as retryable. */
  timeoutMs?: number;
  /** Cooperative cancellation from the runner. */
  signal?: AbortSignal;
}

export interface EngineAdapter {
  readonly key: EngineKey;
  /** Human-readable, shown in the UI next to results. */
  readonly label: string;
  query(prompt: string, options?: QueryOptions): Promise<EngineResult>;
}
