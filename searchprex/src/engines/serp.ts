import type { EngineAdapter, EngineCitation, EngineKey, EngineResult, QueryOptions } from './types.js';
import { EngineError, kindForStatus } from './errors.js';

const DEFAULT_BASE = 'https://serpapi.com/search.json';
const DEFAULT_TIMEOUT_MS = 60_000;

export type SerpSurface = 'aio' | 'copilot';

export interface SerpApiConfig {
  apiKey: string;
  surface: SerpSurface;
  /** Two-letter country for the search locale. Default `us`. */
  country?: string;
  timeoutMs?: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const SURFACE_LABEL: Record<SerpSurface, string> = {
  aio: 'Google AI Overviews',
  // Named honestly. See the class doc: this is the Bing SERP answer surface,
  // which is related to Copilot but is not the Copilot app.
  copilot: 'Bing AI answers',
};

/**
 * Google AI Overviews and Bing's AI answer box, through a SERP vendor.
 *
 * Neither surface has an official API, so a third-party scraper is the only
 * way to reach them. That is a vendor dependency and a per-query cost, not an
 * SLA — treat an outage here as missing data rather than as an absence.
 *
 * ## `answered: false` is the whole point of this adapter
 *
 * **AI Overviews does not fire on most queries.** A commercial query often gets
 * no AI Overview at all. That is a completely different fact from "the AI
 * Overview did not cite you", and every other adapter in this package can
 * ignore the distinction because their surfaces always answer. Here it is the
 * common case, and collapsing it would manufacture gaps for prompts where no
 * surface existed to be cited in — telling the customer to write content for an
 * answer box that never appears.
 *
 * ## What the `copilot` surface actually measures
 *
 * Microsoft retired the Bing Search API and Copilot has no public one. What is
 * reachable is the AI answer box on the Bing results page. It shares retrieval
 * with Copilot but is not the same product, so it is labelled "Bing AI answers"
 * everywhere a person sees it. Reporting it as Copilot would be claiming a
 * measurement that was never taken.
 */
export class SerpApiAdapter implements EngineAdapter {
  readonly key: EngineKey;
  readonly label: string;

  #apiKey: string;
  #surface: SerpSurface;
  #country: string;
  #timeoutMs: number;
  #base: string;
  #fetch: typeof fetch;

  constructor(config: SerpApiConfig) {
    if (config.apiKey.trim() === '') {
      throw new EngineError('auth', config.surface, 'SERPAPI_API_KEY is empty');
    }
    this.key = config.surface;
    this.label = SURFACE_LABEL[config.surface];
    this.#apiKey = config.apiKey;
    this.#surface = config.surface;
    this.#country = config.country ?? 'us';
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#base = config.apiBase ?? DEFAULT_BASE;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async query(prompt: string, options: QueryOptions = {}): Promise<EngineResult> {
    if (prompt.trim() === '') {
      throw new EngineError('bad_request', this.#surface, 'prompt is empty');
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    const params = new URLSearchParams({
      engine: this.#surface === 'aio' ? 'google' : 'bing',
      q: prompt,
      api_key: this.#apiKey,
      gl: countryOf(options.locale) ?? this.#country,
    });

    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}?${params.toString()}`, {
        signal: controller.signal,
      });
    } catch (cause) {
      const callerAborted = options.signal?.aborted === true;
      throw new EngineError(
        controller.signal.aborted && !callerAborted ? 'timeout' : 'network',
        this.#surface,
        controller.signal.aborted && !callerAborted
          ? `request exceeded ${String(timeoutMs)}ms`
          : `transport failure: ${String(cause)}`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      throw new EngineError(
        kindForStatus(response.status),
        this.#surface,
        `HTTP ${String(response.status)} from the SERP vendor`,
        { status: response.status },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new EngineError('parse', this.#surface, 'response was not JSON', { cause });
    }

    return this.#toResult(payload, latencyMs);
  }

  #toResult(payload: unknown, latencyMs: number): EngineResult {
    if (typeof payload !== 'object' || payload === null) {
      throw new EngineError('parse', this.#surface, 'response body was not an object');
    }
    const body = payload as Record<string, unknown>;

    // The vendor reports its own failures inside a 200.
    const error = body['error'];
    if (typeof error === 'string' && error !== '') {
      throw new EngineError('server', this.#surface, `SERP vendor error: ${error}`);
    }

    const block = this.#surface === 'aio' ? body['ai_overview'] : body['answer_box'];

    if (typeof block !== 'object' || block === null) {
      // The surface did not fire. Not an error, and emphatically not "the brand
      // was not cited": there was no answer for anyone to be cited in.
      return {
        engine: this.#surface,
        answered: false,
        answerText: '',
        citations: [],
        servedBy: this.#surface === 'aio' ? 'serpapi/google' : 'serpapi/bing',
        latencyMs,
        raw: payload,
      };
    }

    const record = block as Record<string, unknown>;
    const answerText = this.#surface === 'aio' ? aiOverviewText(record) : answerBoxText(record);

    return {
      engine: this.#surface,
      answered: answerText.trim() !== '',
      answerText,
      citations: extractReferences(record),
      servedBy: this.#surface === 'aio' ? 'serpapi/google' : 'serpapi/bing',
      latencyMs,
      raw: payload,
    };
  }
}

/**
 * AI Overview text blocks, flattened.
 *
 * A block is a paragraph, a list, or a nested list of paragraphs. Only the
 * prose matters for brand-mention matching, so the structure is discarded and
 * the snippets are joined.
 */
function aiOverviewText(block: Record<string, unknown>): string {
  const blocks = block['text_blocks'];
  if (!Array.isArray(blocks)) return '';

  const chunks: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;

    const snippet = record['snippet'];
    if (typeof snippet === 'string' && snippet !== '') chunks.push(snippet);

    const list = record['list'];
    if (list !== undefined) walk(list);
  };

  walk(blocks);
  return chunks.join('\n').trim();
}

function answerBoxText(block: Record<string, unknown>): string {
  for (const field of ['answer', 'snippet', 'result', 'description']) {
    const value = block[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }

  const snippets = block['snippets'];
  if (Array.isArray(snippets)) {
    return snippets.filter((s): s is string => typeof s === 'string').join('\n').trim();
  }
  return '';
}

/** Sources cited beside the answer, deduplicated in first-appearance order. */
function extractReferences(block: Record<string, unknown>): EngineCitation[] {
  const out: EngineCitation[] = [];
  const seen = new Set<string>();

  for (const field of ['references', 'links', 'sources']) {
    const list = block[field];
    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;

      const url = ['link', 'url', 'source_link'].reduce<string>(
        (found, key) =>
          found !== '' ? found : typeof record[key] === 'string' ? (record[key] as string) : '',
        '',
      );
      if (url === '' || seen.has(url)) continue;
      seen.add(url);

      const title = record['title'];
      out.push({
        position: out.length + 1,
        url,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
      });
    }
  }

  return out;
}

function countryOf(locale: string | undefined): string | undefined {
  if (locale === undefined) return undefined;
  const parts = locale.split(/[-_]/);
  const region = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return region !== undefined && /^[A-Za-z]{2}$/.test(region) ? region.toLowerCase() : undefined;
}
