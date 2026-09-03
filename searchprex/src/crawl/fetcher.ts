/**
 * Polite HTTP fetching for the site crawler.
 *
 * Everything here is capped. A crawl runs against a customer's production
 * store, so a runaway loop is not a slow job — it is an outage the customer
 * pays for and blames on us.
 */

export const DEFAULT_USER_AGENT =
  'SearchprexBot/0.1 (+https://searchprex.com/bot)';

/**
 * The crawlers we can impersonate when probing for edge-level blocking.
 *
 * robots.txt is only half the picture: CDNs now block AI crawlers at the edge
 * by default, so a site can have a permissive robots.txt and still return 403
 * to OAI-SearchBot. That block is invisible to a normal fetch and is one of
 * the most common causes of an otherwise healthy page never being cited.
 *
 * Sending another company's user-agent string is only defensible against a
 * site the customer owns and has asked us to audit, so `fetchPage` refuses to
 * use these against any other host. See `probeAiCrawlers`.
 */
export const AI_CRAWLER_USER_AGENTS: Record<string, string> = {
  'OAI-SearchBot': 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'ChatGPT-User': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
  PerplexityBot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Perplexity-User': 'Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

/** Pages above this are not answer pages; reading them wastes memory. */
const MAX_BYTES = 3_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface FetchResult {
  url: string;
  /** Final URL after redirects — not the same as `url` when the site redirects. */
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Empty for non-HTML or over-sized responses; `truncated` says which. */
  body: string;
  truncated: boolean;
  error?: string;
}

export interface FetchOptions {
  userAgent?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = options;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type');
    const declaredLength = Number(response.headers.get('content-length') ?? '0');

    // Skip the body for anything we cannot analyse. The status still matters —
    // it is what tells us whether a crawler is being blocked.
    const isTextual =
      contentType === null || /text\/html|xml|text\/plain|json/i.test(contentType);
    if (!isTextual || declaredLength > MAX_BYTES) {
      return {
        url,
        finalUrl: response.url === '' ? url : response.url,
        status: response.status,
        contentType,
        body: '',
        truncated: declaredLength > MAX_BYTES,
      };
    }

    const text = await response.text();
    const truncated = text.length > MAX_BYTES;

    return {
      url,
      finalUrl: response.url === '' ? url : response.url,
      status: response.status,
      contentType,
      body: truncated ? text.slice(0, MAX_BYTES) : text,
      truncated,
    };
  } catch (cause) {
    return {
      url,
      finalUrl: url,
      status: 0,
      contentType: null,
      body: '',
      truncated: false,
      error: controller.signal.aborted ? `timeout after ${timeoutMs}ms` : String(cause),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

export const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
