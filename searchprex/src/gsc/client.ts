import { EngineError, backoffMs, kindForStatus } from '../engines/errors.js';
import type { TokenSource } from './auth.js';
import type { SearchAnalyticsOptions, SearchAnalyticsRow } from './types.js';

const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
/** The API's own ceiling for one page. */
const MAX_PAGE = 25_000;
/** Search Console data lags two to three days. */
const LAG_DAYS = 3;
const DEFAULT_WINDOW_DAYS = 90;

export interface SearchConsoleConfig {
  /**
   * The property as Search Console names it: `sc-domain:example.com` for a
   * domain property, or `https://www.example.com/` for a URL-prefix one. These
   * are different properties with different data, and picking the wrong one
   * returns a 403 rather than an empty result.
   */
  siteUrl: string;
  tokens: TokenSource;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class SearchConsoleClient {
  #siteUrl: string;
  #tokens: TokenSource;
  #base: string;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;

  constructor(config: SearchConsoleConfig) {
    if (config.siteUrl.trim() === '') {
      throw new EngineError('bad_request', 'gsc', 'siteUrl is empty');
    }
    this.#siteUrl = config.siteUrl;
    this.#tokens = config.tokens;
    this.#base = config.apiBase ?? API_BASE;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
    this.#sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Properties this credential can read.
   *
   * Shown after connecting so the customer picks one. A Google account often
   * holds several, and a domain property and a URL-prefix property for the same
   * site are different properties with different data — guessing returns 403 or,
   * worse, an empty result that reads as "no queries".
   */
  async sites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
    const response = await this.#fetch(`${this.#base}/sites`, {
      headers: { Authorization: `Bearer ${await this.#tokens.accessToken()}` },
    });

    if (!response.ok) {
      throw new EngineError(
        kindForStatus(response.status),
        'gsc',
        `listing properties failed with HTTP ${String(response.status)}`,
        { status: response.status },
      );
    }

    const body = (await response.json()) as { siteEntry?: unknown };
    if (!Array.isArray(body.siteEntry)) return [];

    return body.siteEntry.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const siteUrl = record['siteUrl'];
      if (typeof siteUrl !== 'string') return [];
      return [
        {
          siteUrl,
          permissionLevel: String(record['permissionLevel'] ?? 'unknown'),
        },
      ];
    });
  }

  /** Top queries for the property, most impressions first. */
  async queries(options: SearchAnalyticsOptions = {}): Promise<SearchAnalyticsRow[]> {
    const endDate = options.endDate ?? isoDaysAgo(LAG_DAYS);
    const startDate = options.startDate ?? isoDaysBefore(endDate, DEFAULT_WINDOW_DAYS);
    const limit = Math.max(1, options.limit ?? 500);

    const rows: SearchAnalyticsRow[] = [];
    let startRow = 0;

    while (rows.length < limit) {
      const page = await this.#page({
        startDate,
        endDate,
        rowLimit: Math.min(MAX_PAGE, limit - rows.length),
        startRow,
        ...(options.searchType === undefined ? {} : { type: options.searchType }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });

      rows.push(...page);
      // A short page means there is nothing after it; without this the loop
      // re-requests the same empty tail until the limit is reached.
      if (page.length === 0) break;
      startRow += page.length;
    }

    return rows.slice(0, limit);
  }

  async #page(args: {
    startDate: string;
    endDate: string;
    rowLimit: number;
    startRow: number;
    type?: string;
    signal?: AbortSignal;
  }): Promise<SearchAnalyticsRow[]> {
    // `sc-domain:example.com` contains a colon, which has to be percent-encoded
    // or the API reads the property name as a malformed URL and 404s.
    const path = `${this.#base}/sites/${encodeURIComponent(this.#siteUrl)}/searchAnalytics/query`;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await this.#fetch(path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.#tokens.accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: ['query'],
          rowLimit: args.rowLimit,
          startRow: args.startRow,
          type: args.type ?? 'web',
        }),
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });

      if (response.ok) {
        const body = (await response.json()) as { rows?: unknown };
        return parseRows(body.rows);
      }

      const kind = kindForStatus(response.status);
      // Search Console rate-limits per property and per day. A retry with
      // backoff is the documented handling; a 403 here usually means the
      // property is not one this credential can read, and retrying will not
      // change that.
      if ((kind === 'rate_limit' || kind === 'server') && attempt < 3) {
        await this.#sleep(backoffMs(attempt));
        continue;
      }

      throw new EngineError(kind, 'gsc', `Search Console returned HTTP ${String(response.status)}`, {
        status: response.status,
      });
    }

    return [];
  }
}

function parseRows(rows: unknown): SearchAnalyticsRow[] {
  if (!Array.isArray(rows)) return [];

  const out: SearchAnalyticsRow[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    const keys = record['keys'];
    const query = Array.isArray(keys) && typeof keys[0] === 'string' ? keys[0] : '';
    if (query === '') continue;

    out.push({
      query,
      clicks: Number(record['clicks'] ?? 0),
      impressions: Number(record['impressions'] ?? 0),
      ctr: Number(record['ctr'] ?? 0),
      position: Number(record['position'] ?? 0),
    });
  }
  return out;
}

export function isoDaysAgo(days: number, from = new Date()): string {
  const date = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function isoDaysBefore(iso: string, days: number): string {
  return isoDaysAgo(days, new Date(`${iso}T00:00:00Z`));
}
