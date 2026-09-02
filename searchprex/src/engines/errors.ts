/**
 * Engine errors, split by whether the runner should retry.
 *
 * The distinction matters for cost: a run is prompts x engines x 3, so blindly
 * retrying a 400 caused by a malformed prompt burns budget on a call that will
 * never succeed, while not retrying a 429 throws away a whole prompt's data.
 */

export type EngineErrorKind =
  | 'auth'          // bad or missing key — never retry, alert the operator
  | 'rate_limit'    // 429 — retry with backoff, honour Retry-After
  | 'server'        // 5xx — retry with backoff
  | 'timeout'       // exceeded timeoutMs — retry once
  | 'bad_request'   // 4xx that is our fault — never retry
  | 'parse'         // response arrived but did not match any known shape
  | 'network';      // transport failure — retry with backoff

const RETRYABLE: ReadonlySet<EngineErrorKind> = new Set([
  'rate_limit',
  'server',
  'timeout',
  'network',
]);

export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  readonly engine: string;
  readonly status?: number;
  /** Seconds to wait, when the provider told us. */
  readonly retryAfter?: number;
  readonly body?: string;

  constructor(
    kind: EngineErrorKind,
    engine: string,
    message: string,
    extra: { status?: number; retryAfter?: number; body?: string; cause?: unknown } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = 'EngineError';
    this.kind = kind;
    this.engine = engine;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    if (extra.body !== undefined) this.body = extra.body;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

/** Map an HTTP status to an error kind. */
export function kindForStatus(status: number): EngineErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/**
 * Backoff for a retryable failure. Exponential from `baseMs`, capped, with
 * full jitter so a fanned-out run does not resynchronise its retries into a
 * second thundering herd against the same rate limit.
 */
export function backoffMs(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; retryAfter?: number } = {},
): number {
  const { baseMs = 1_000, capMs = 60_000, retryAfter } = opts;
  if (retryAfter !== undefined && Number.isFinite(retryAfter)) {
    return Math.min(retryAfter * 1_000, capMs);
  }
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(Math.random() * ceiling);
}
