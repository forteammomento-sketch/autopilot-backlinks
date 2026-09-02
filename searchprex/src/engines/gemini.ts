import type { EngineAdapter, EngineCitation, EngineResult, QueryOptions } from './types.js';
import { EngineError, kindForStatus } from './errors.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

/** Google wraps every grounding source in a redirect host. */
const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  /**
   * Grounding tool name. `google_search` on Gemini 2.x; 1.5 models used
   * `google_search_retrieval` and reject the newer name.
   */
  toolName?: string;
  timeoutMs?: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Gemini adapter, over the Generative Language API with Google Search grounding.
 *
 * ## The redirect problem
 *
 * `groundingChunks[].web.uri` is **not the page's URL**. It is a link into
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/...`, and those
 * redirects expire. Using them directly would make every citation resolve to
 * one Google domain: the customer's own pages would never match, every
 * competitor check would fail, and the placement graph would contain a single
 * entry. The whole measurement would read as "nobody is ever cited".
 *
 * `web.title` carries the real source — usually the bare domain. It is
 * preferred whenever it parses as a hostname, and the redirect is kept only
 * when there is nothing better, marked so downstream can tell.
 *
 * Like the other adapters, no system instruction and no temperature override:
 * see `perplexity.ts` for why steering the answer destroys the measurement.
 */
export class GeminiAdapter implements EngineAdapter {
  readonly key = 'gemini' as const;
  readonly label = 'Gemini';

  #apiKey: string;
  #model: string;
  #toolName: string;
  #timeoutMs: number;
  #base: string;
  #fetch: typeof fetch;

  constructor(config: GeminiConfig) {
    if (config.apiKey.trim() === '') {
      throw new EngineError('auth', 'gemini', 'GEMINI_API_KEY is empty');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.#toolName = config.toolName ?? 'google_search';
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#base = config.apiBase ?? API_BASE;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async query(prompt: string, options: QueryOptions = {}): Promise<EngineResult> {
    if (prompt.trim() === '') {
      throw new EngineError('bad_request', 'gemini', 'prompt is empty');
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#base}/models/${encodeURIComponent(this.#model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            // The key goes in a header, not the query string: a URL with a
            // credential in it lands in access logs and proxy traces.
            'x-goog-api-key': this.#apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ [this.#toolName]: {} }],
          }),
          signal: controller.signal,
        },
      );
    } catch (cause) {
      const callerAborted = options.signal?.aborted === true;
      throw new EngineError(
        controller.signal.aborted && !callerAborted ? 'timeout' : 'network',
        'gemini',
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
        'gemini',
        `HTTP ${String(response.status)} from the Gemini API`,
        { status: response.status, body: (await response.text().catch(() => '')).slice(0, 500) },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new EngineError('parse', 'gemini', 'response was not JSON', { cause });
    }

    return this.#toResult(payload, latencyMs);
  }

  #toResult(payload: unknown, latencyMs: number): EngineResult {
    if (typeof payload !== 'object' || payload === null) {
      throw new EngineError('parse', 'gemini', 'response body was not an object');
    }
    const body = payload as Record<string, unknown>;
    const candidate = firstCandidate(body);

    const answerText = extractText(candidate);
    const citations = extractCitations(candidate);

    return {
      engine: 'gemini',
      // A blocked or empty candidate is not "the surface did not fire" — Gemini
      // always answers when it answers at all — so this only goes false when
      // safety filtering or an empty candidate leaves nothing.
      answered: answerText.trim() !== '',
      answerText,
      citations,
      servedBy: typeof body['modelVersion'] === 'string' ? body['modelVersion'] : this.#model,
      latencyMs,
      raw: payload,
    };
  }
}

function firstCandidate(body: Record<string, unknown>): Record<string, unknown> | null {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
}

function extractText(candidate: Record<string, unknown> | null): string {
  if (candidate === null) return '';
  const content = candidate['content'];
  if (typeof content !== 'object' || content === null) return '';

  const parts = (content as Record<string, unknown>)['parts'];
  if (!Array.isArray(parts)) return '';

  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const text = (part as Record<string, unknown>)['text'];
    if (typeof text === 'string') chunks.push(text);
  }
  return chunks.join('').trim();
}

function extractCitations(candidate: Record<string, unknown> | null): EngineCitation[] {
  if (candidate === null) return [];
  const metadata = candidate['groundingMetadata'];
  if (typeof metadata !== 'object' || metadata === null) return [];

  const chunks = (metadata as Record<string, unknown>)['groundingChunks'];
  if (!Array.isArray(chunks)) return [];

  const out: EngineCitation[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (typeof chunk !== 'object' || chunk === null) continue;
    const web = (chunk as Record<string, unknown>)['web'];
    if (typeof web !== 'object' || web === null) continue;

    const record = web as Record<string, unknown>;
    const uri = typeof record['uri'] === 'string' ? record['uri'] : '';
    const title = typeof record['title'] === 'string' ? record['title'] : '';

    const url = resolveSourceUrl(uri, title);
    if (url === null || seen.has(url)) continue;
    seen.add(url);

    out.push({ position: out.length + 1, url, ...(title === '' ? {} : { title }) });
  }

  return out;
}

/**
 * The real source URL, or the redirect when nothing better is available.
 *
 * Gemini's `title` for a web chunk is normally the source's domain
 * ("bladehq.com"). When it parses as a hostname it is used, because a citation
 * that resolves to Google tells us nothing about who was cited.
 */
export function resolveSourceUrl(uri: string, title: string): string | null {
  const isRedirect = uri.includes(REDIRECT_HOST);

  if (isRedirect && looksLikeHostname(title)) {
    return `https://${title.trim().toLowerCase()}`;
  }
  if (uri.trim() !== '') return uri;
  if (looksLikeHostname(title)) return `https://${title.trim().toLowerCase()}`;
  return null;
}

function looksLikeHostname(value: string): boolean {
  const candidate = value.trim().toLowerCase();
  // A domain, not a page title: no spaces, at least one dot, a plausible TLD.
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(candidate) && !candidate.includes(' ');
}
