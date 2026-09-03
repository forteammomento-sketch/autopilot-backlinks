export interface SearchAnalyticsRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  /** Average position, 1-based. */
  position: number;
}

export interface SearchAnalyticsOptions {
  /** ISO date, inclusive. Defaults to 90 days before `endDate`. */
  startDate?: string;
  /**
   * ISO date, inclusive. Defaults to three days ago.
   *
   * Search Console data lags by two to three days. Asking for today returns an
   * empty result, which is easy to mistake for "this site has no queries" —
   * the single most common way this integration is got wrong.
   */
  endDate?: string;
  /** Rows to fetch in total. The API caps a single page at 25,000. */
  limit?: number;
  /** `web` (default), `image`, `video`, `news` or `discover`. */
  searchType?: string;
  signal?: AbortSignal;
}
