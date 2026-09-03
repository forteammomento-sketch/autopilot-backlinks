import type { SiteIndex } from '../crawl/crawl.js';
import type { SearchAnalyticsRow } from '../gsc/types.js';
import { namesBrand } from './intent.js';
import type { PromptSeed } from './types.js';

/**
 * Seeds from the site's own catalogue.
 *
 * Product and category pages only. A prompt generated from an About page is a
 * question nobody asks before buying, and it costs the same to measure as one
 * that matters.
 */
export function seedsFromCrawl(index: SiteIndex, limit = 40): PromptSeed[] {
  const seeds: PromptSeed[] = [];

  for (const page of index.pages) {
    const path = pathOf(page.finalUrl);
    if (!/\/(?:products?|collections?|category|categories|shop)\//i.test(path)) continue;

    const name = cleanTitle(page.heading ?? page.title ?? '');
    if (name === '') continue;

    seeds.push({ text: name, cluster: clusterFromPath(path) });
    if (seeds.length >= limit) break;
  }

  return seeds;
}

export type QueryRow = Pick<SearchAnalyticsRow, 'query' | 'impressions'> &
  Partial<SearchAnalyticsRow>;

export interface SearchConsoleSeedOptions {
  /** Brand names, so branded demand is not turned into prompts. */
  brandAliases?: string[];
  /** Ignore queries below this many impressions. Default 1. */
  minImpressions?: number;
}

/**
 * Rank a query by how much there is to gain from working on it.
 *
 * Raw impressions is the wrong sort. The queries worth building prompts around
 * are the ones already earning impressions the site is not converting — which
 * is the whole diagnosis behind this project. Three cases are treated
 * differently:
 *
 * - **Position past 30.** Scored zero. Gate 2 says an engine will not retrieve
 *   a page that far down, so a prompt built here cannot be won no matter what
 *   is written. Paying to measure it weekly buys nothing.
 * - **Position 1-3 with clicks already coming.** Heavily discounted. This is
 *   demand the site already converts; a citation adds little.
 * - **Everything between.** Visible, not winning. This is where the work pays,
 *   and it is scored by the impressions being left on the table.
 */
export function opportunityScore(row: QueryRow): number {
  const position = row.position ?? 15;
  const ctr = row.ctr ?? 0;

  if (position > 30) return 0;

  const positionWeight = position <= 3 ? 0.3 : position <= 20 ? 1 : 0.5;
  return row.impressions * (1 - Math.min(1, ctr)) * positionWeight;
}

/**
 * Seeds from Search Console.
 *
 * The strongest source available: queries the site already earns impressions
 * for are measured demand on pages that already rank somewhere, so a prompt
 * built from one has a chance at gate 2 that an invented one does not.
 *
 * Branded queries are dropped. They are demand the site already owns, and a
 * prompt built from one produces a question the shop nearly always wins —
 * exactly what the generator rejects downstream, so filtering here saves the
 * model call as well as the measurement.
 */
export function seedsFromSearchConsole(
  rows: QueryRow[],
  limit = 40,
  options: SearchConsoleSeedOptions = {},
): PromptSeed[] {
  const { brandAliases = [], minImpressions = 1 } = options;

  return rows
    .filter((row) => row.query.trim() !== '' && row.impressions >= minImpressions)
    .filter((row) => !namesBrand(row.query, brandAliases))
    .map((row) => ({ row, score: opportunityScore(row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      text: entry.row.query.trim(),
      cluster: headTerm(entry.row.query),
      impressions: entry.row.impressions,
    }));
}

/**
 * Combine seed sources, best first.
 *
 * Search Console leads because it is measured demand rather than inferred
 * demand. Catalogue seeds fill the gap for products that earn no impressions
 * yet — which, for a store whose pages are not indexed, is most of them.
 */
export function mergeSeeds(...sources: PromptSeed[][]): PromptSeed[] {
  const seen = new Set<string>();
  const out: PromptSeed[] = [];

  for (const source of sources) {
    for (const seed of source) {
      const key = seed.text.toLowerCase().trim();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push(seed);
    }
  }
  return out;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** `/collections/hunting-knives/x` → `hunting knives`. */
function clusterFromPath(path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  const index = parts.findIndex((p) => /^(?:products?|collections?|category|categories|shop)$/i.test(p));
  const slug = index === -1 ? parts[0] : parts[index + 1];
  return slug === undefined ? 'uncategorised' : slug.replace(/[-_]+/g, ' ').toLowerCase();
}

/** First two content words of a query, as a rough cluster. */
function headTerm(query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return words.slice(0, 2).join(' ') || 'uncategorised';
}

/** Strip the site name and separators retailers append to every title. */
function cleanTitle(title: string): string {
  return title
    .split(/\s+[|–—-]\s+/)[0]
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';
}
