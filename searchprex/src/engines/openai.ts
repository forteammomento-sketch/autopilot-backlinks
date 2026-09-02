import type {
  EngineAdapter,
  EngineCitation,
  EngineResult,
  QueryOptions,
} from './types.js';
import { EngineError, kindForStatus } from './errors.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TOOL = 'web_search';
const DEFAULT_TIMEOUT_MS = 90_000;

export interface OpenAIConfig {
  apiKey: string;
  /** Must be a model that supports the web search tool. Default `gpt-4o`. */
  model?: string;
  /**
   * Tool identifier. OpenAI shipped this as `web_search_preview` before
   * `web_search`; older accounts still only accept the preview name. If a call
   * fails with a 400 naming the tool, set this rather than changing the model.
   */
  toolType?: string;
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * ChatGPT search adapter, over the Responses API with the web search tool.
 *
 * ## What this does and does not measure
 *
 * This is the API's search behaviour, not a transcript of consumer
 * chatgpt.com. The retrieval stack is the same but the consumer product adds
 * memory, custom instructions and its own system prompt, so citations can
 * differ. That gap is real and the UI must say so next to the number rather
 * than implying we replayed a user's session.
 *
 * Like the Perplexity adapter, no system message and no temperature override
 * are sent — see `perplexity.ts` for why steering the answer destroys the
 * measurement.
 *
 * ## Citation extraction
 *
 * Citations arrive as `url_citation` annotations attached to spans of the
 * answer text, so the same URL appears once per span it supports — a page
 * backing three sentences yields three annotations. Deduplicating by URL while
 * preserving first-appearance order is what turns them into the ranked source
 * list the rest of the pipeline expects; skipping that step would report a
 * single well-used source as several citations and inflate every count
 * downstream.
 */
export class OpenAIAdapter implements EngineAdapter {
  readonly key = 'openai' as const;
  readonly label = 'ChatGPT search';

  #apiKey: string;
  #model: string;
  #toolType: string;
  #timeoutMs: number;
  #endpoint: string;
  #fetch: typeof fetch;

  constructor(config: OpenAIConfig) {
    if (config.apiKey.trim() === '') {
      throw new EngineError('auth', 'openai', 'OPENAI_API_KEY is empty');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.#toolType = config.toolType ?? DEFAULT_TOOL;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#endpoint = config.endpoint ?? ENDPOINT;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async query(prompt: string, options: QueryOptions = {}): Promise<EngineResult> {
    if (prompt.trim() === '') {
      throw new EngineError('bad_request', 'openai', 'prompt is empty');
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
          input: prompt,
          tools: [
            {
              type: this.#toolType,
              ...(options.locale === undefined
                ? {}
                : { user_location: { type: 'approximate', country: countryOf(options.locale) } }),
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      const callerAborted = options.signal?.aborted === true;
      throw new EngineError(
        controller.signal.aborted && !callerAborted ? 'timeout' : 'network',
        'openai',
        controller.signal.aborted && !callerAborted
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
        'openai',
        `HTTP ${response.status} from Responses API`,
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
      throw new EngineError('parse', 'openai', 'response was not JSON', { cause });
    }

    return this.#toResult(payload, latencyMs);
  }

  #toResult(payload: unknown, latencyMs: number): EngineResult {
    if (typeof payload !== 'object' || payload === null) {
      throw new EngineError('parse', 'openai', 'response body was not an object');
    }
    const body = payload as Record<string, unknown>;

    // A 200 can still carry a failed response object.
    const status = body['status'];
    if (status === 'failed') {
      const error = body['error'];
      const message =
        typeof error === 'object' && error !== null
          ? String((error as Record<string, unknown>)['message'] ?? 'unknown')
          : 'unknown';
      throw new EngineError('server', 'openai', `response failed: ${message}`);
    }

    const { text, citations } = extractOutput(body);

    return {
      engine: 'openai',
      // `incomplete` means the model was cut off; whatever text arrived is
      // still what a user would have seen up to that point.
      answered: text.trim() !== '',
      answerText: text,
      citations,
      servedBy: typeof body['model'] === 'string' ? body['model'] : this.#model,
      latencyMs,
      raw: payload,
    };
  }
}

interface Extracted {
  text: string;
  citations: EngineCitation[];
}

function extractOutput(body: Record<string, unknown>): Extracted {
  const output = body['output'];
  if (!Array.isArray(output)) return { text: '', citations: [] };

  const chunks: string[] = [];
  const seen = new Set<string>();
  const citations: EngineCitation[] = [];

  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const node = item as Record<string, unknown>;
    // Skip `web_search_call` and other non-message items.
    if (node['type'] !== 'message') continue;

    const content = node['content'];
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const contentPart = part as Record<string, unknown>;
      if (contentPart['type'] !== 'output_text') continue;

      const text = contentPart['text'];
      if (typeof text === 'string') chunks.push(text);

      const annotations = contentPart['annotations'];
      if (!Array.isArray(annotations)) continue;

      for (const annotation of annotations) {
        if (typeof annotation !== 'object' || annotation === null) continue;
        const row = annotation as Record<string, unknown>;
        if (row['type'] !== 'url_citation') continue;

        const url = row['url'];
        if (typeof url !== 'string' || url.trim() === '') continue;
        if (seen.has(url)) continue;
        seen.add(url);

        const title = row['title'];
        citations.push({
          position: citations.length + 1,
          url,
          ...(typeof title === 'string' && title !== '' ? { title } : {}),
        });
      }
    }
  }

  return { text: chunks.join('\n').trim(), citations };
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

function countryOf(locale: string): string {
  const parts = locale.split(/[-_]/);
  const region = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return region !== undefined && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : 'US';
}
