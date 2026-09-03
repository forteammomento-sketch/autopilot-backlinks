import type {
  EngineAdapter,
  EngineCitation,
  EngineResult,
  QueryOptions,
} from './types.js';
import { EngineError, kindForStatus } from './errors.js';

const ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar';
const DEFAULT_TIMEOUT_MS = 45_000;

export interface PerplexityConfig {
  apiKey: string;
  /** `sonar` | `sonar-pro` | `sonar-reasoning` | ... Default `sonar`. */
  model?: string;
  timeoutMs?: number;
  /** Override for tests. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Perplexity Sonar adapter.
 *
 * ## Measurement neutrality
 *
 * This adapter deliberately sends the prompt with **no system message, no
 * temperature override and no `search_domain_filter`**. Every one of those
 * knobs would improve the answer and destroy the measurement:
 *
 * - A system prompt ("answer concisely, cite sources") changes retrieval and
 *   phrasing, so we would be measuring our own prompt engineering rather than
 *   what a customer's buyer actually sees.
 * - Pinning `temperature: 0` would suppress the run-to-run variance that the
 *   3x repeat exists to quantify, making single-run results look far more
 *   stable than the surface really is.
 * - `search_domain_filter` would let us hand the engine the customer's domain,
 *   which is the measurement equivalent of marking your own exam.
 *
 * If a caller needs a steered answer for some other product surface, that is a
 * different adapter. This one answers exactly one question: what does
 * Perplexity say to an unprimed user, and who does it cite?
 *
 * ## Response shape
 *
 * Sonar has returned sources two ways: a legacy `citations: string[]` and the
 * current `search_results: {title, url, date}[]`. Both are parsed, current
 * shape preferred, so the adapter keeps working across the provider's
 * migration in either direction.
 */
export class PerplexityAdapter implements EngineAdapter {
  readonly key = 'perplexity' as const;
  readonly label = 'Perplexity';

  #apiKey: string;
  #model: string;
  #timeoutMs: number;
  #endpoint: string;
  #fetch: typeof fetch;

  constructor(config: PerplexityConfig) {
    if (config.apiKey.trim() === '') {
      throw new EngineError('auth', 'perplexity', 'PERPLEXITY_API_KEY is empty');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#endpoint = config.endpoint ?? ENDPOINT;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async query(prompt: string, options: QueryOptions = {}): Promise<EngineResult> {
    if (prompt.trim() === '') {
      throw new EngineError('bad_request', 'perplexity', 'prompt is empty');
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.#model,
          messages: [{ role: 'user', content: prompt }],
          ...(options.locale === undefined
            ? {}
            : { web_search_options: { user_location: { country: countryOf(options.locale) } } }),
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = options.signal?.aborted === true;
      throw new EngineError(
        controller.signal.aborted && !aborted ? 'timeout' : 'network',
        'perplexity',
        controller.signal.aborted && !aborted
          ? `request exceeded ${timeoutMs}ms`
          : `transport failure: ${String(cause)}`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await safeText(response);
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      throw new EngineError(
        kindForStatus(response.status),
        'perplexity',
        `HTTP ${response.status} from Sonar`,
        {
          status: response.status,
          body,
          ...(retryAfter === undefined ? {} : { retryAfter }),
        },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new EngineError('parse', 'perplexity', 'response was not JSON', { cause });
    }

    return this.#toResult(payload, latencyMs);
  }

  #toResult(payload: unknown, latencyMs: number): EngineResult {
    if (typeof payload !== 'object' || payload === null) {
      throw new EngineError('parse', 'perplexity', 'response body was not an object');
    }
    const body = payload as Record<string, unknown>;

    const answerText = stripReasoning(extractContent(body));
    const citations = extractCitations(body);

    return {
      engine: 'perplexity',
      // Sonar always answers; an empty body means something went wrong upstream
      // rather than "this surface did not fire", which is an AI Overviews state.
      answered: answerText.trim() !== '',
      answerText,
      citations,
      servedBy: typeof body['model'] === 'string' ? body['model'] : this.#model,
      latencyMs,
      raw: payload,
    };
  }
}

function extractContent(body: Record<string, unknown>): string {
  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return '';
  const message = (first as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : '';
}

/**
 * `sonar-reasoning*` models prefix the answer with a `<think>` block. That is
 * the model's scratchpad, not the answer a user sees, so it must not reach
 * brand-mention matching — a brand named while reasoning and then dropped from
 * the answer would otherwise count as a mention.
 */
function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractCitations(body: Record<string, unknown>): EngineCitation[] {
  const searchResults = body['search_results'];
  if (Array.isArray(searchResults) && searchResults.length > 0) {
    const out: EngineCitation[] = [];
    for (const entry of searchResults) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as Record<string, unknown>;
      const url = row['url'];
      if (typeof url !== 'string' || url.trim() === '') continue;
      const title = row['title'];
      const date = row['date'];
      out.push({
        position: out.length + 1,
        url,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        ...(typeof date === 'string' && date !== '' ? { date } : {}),
      });
    }
    if (out.length > 0) return out;
  }

  // Legacy shape: a bare array of URL strings.
  const legacy = body['citations'];
  if (Array.isArray(legacy)) {
    const out: EngineCitation[] = [];
    for (const url of legacy) {
      if (typeof url !== 'string' || url.trim() === '') continue;
      out.push({ position: out.length + 1, url });
    }
    return out;
  }

  return [];
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const asDate = Date.parse(header);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, Math.round((asDate - Date.now()) / 1_000));
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2_000);
  } catch {
    return '';
  }
}

/** `en-US` -> `US`. Sonar wants an ISO-3166 country, not a full locale tag. */
function countryOf(locale: string): string {
  const parts = locale.split(/[-_]/);
  const region = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return region !== undefined && /^[A-Za-z]{2}$/.test(region)
    ? region.toUpperCase()
    : 'US';
}
