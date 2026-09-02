import type { EngineAdapter, EngineResult, QueryOptions } from '../engines/types.js';
import { EngineError, backoffMs } from '../engines/errors.js';
import { analyseResult, type ProjectContext, type ResultAnalysis } from '../lib/citations.js';

export interface SampleOptions extends QueryOptions {
  /**
   * How many times to ask the same prompt. Default 3.
   *
   * These models return different answers to identical prompts, so a single
   * call is a sample of size one and reporting it as "you are cited" is
   * reporting noise. Three calls is the smallest count that distinguishes
   * "always", "sometimes" and "never", which is the resolution the Actions
   * queue actually needs.
   */
  repeats?: number;
  /** Retries per individual call, on retryable errors only. Default 2. */
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SampledAttempt {
  attempt: number;
  result?: EngineResult;
  analysis?: ResultAnalysis;
  error?: { kind: string; message: string };
}

export interface SampledPrompt {
  engine: string;
  prompt: string;
  attempts: SampledAttempt[];
  /** Successful calls out of `repeats`. */
  succeeded: number;
  /** Calls in which the brand was cited, out of `succeeded`. */
  citedCount: number;
  mentionedCount: number;
  /**
   * `cited`      — cited in every successful call
   * `contested`  — cited in some but not all
   * `absent`     — cited in none
   * `unknown`    — no call succeeded
   *
   * `contested` is a real and common state. Collapsing it into cited/absent is
   * the single most misleading thing an AI visibility tool can do.
   */
  verdict: 'cited' | 'contested' | 'absent' | 'unknown';
  /** Union of every third-party domain seen across attempts. */
  thirdPartyDomains: string[];
  /** Union of every competitor domain seen across attempts. */
  competitorDomainsCited: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One call, with backoff on retryable failures. */
export async function queryWithRetry(
  adapter: EngineAdapter,
  prompt: string,
  options: SampleOptions = {},
): Promise<EngineResult> {
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      return await adapter.query(prompt, options);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof EngineError && error.retryable;
      if (!retryable || attempt === maxRetries + 1) throw error;
      await sleep(
        backoffMs(attempt, {
          ...(error instanceof EngineError && error.retryAfter !== undefined
            ? { retryAfter: error.retryAfter }
            : {}),
        }),
      );
    }
  }
  throw lastError;
}

/**
 * Ask one prompt of one engine `repeats` times and summarise.
 *
 * Attempts run sequentially rather than in parallel: three simultaneous
 * identical requests are the fastest way to trip a provider rate limit, and
 * the run is already fanned out across prompts at the job level, where
 * concurrency can be controlled per engine key.
 */
export async function samplePrompt(
  adapter: EngineAdapter,
  prompt: string,
  context: ProjectContext,
  options: SampleOptions = {},
): Promise<SampledPrompt> {
  const repeats = options.repeats ?? 3;
  const attempts: SampledAttempt[] = [];

  for (let i = 1; i <= repeats; i += 1) {
    try {
      const result = await queryWithRetry(adapter, prompt, options);
      attempts.push({ attempt: i, result, analysis: analyseResult(result, context) });
    } catch (error) {
      attempts.push({
        attempt: i,
        error:
          error instanceof EngineError
            ? { kind: error.kind, message: error.message }
            : { kind: 'unknown', message: String(error) },
      });
    }
  }

  const analyses = attempts
    .map((a) => a.analysis)
    .filter((a): a is ResultAnalysis => a !== undefined);

  const succeeded = analyses.length;
  const citedCount = analyses.filter((a) => a.brandCited).length;
  const mentionedCount = analyses.filter((a) => a.brandMentioned).length;

  return {
    engine: adapter.key,
    prompt,
    attempts,
    succeeded,
    citedCount,
    mentionedCount,
    verdict: verdictFor(succeeded, citedCount),
    thirdPartyDomains: unionOf(analyses.map((a) => a.thirdPartyDomains)),
    competitorDomainsCited: unionOf(analyses.map((a) => a.competitorDomainsCited)),
  };
}

function verdictFor(succeeded: number, cited: number): SampledPrompt['verdict'] {
  if (succeeded === 0) return 'unknown';
  if (cited === 0) return 'absent';
  return cited === succeeded ? 'cited' : 'contested';
}

function unionOf(lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}
