import type { SiteIndex } from '../crawl/crawl.js';
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

/**
 * Seeds from Search Console.
 *
 * These are the strongest seeds available: queries the site already earns
 * impressions for are demand that exists, on pages that already rank somewhere.
 * A prompt built from one of these has a chance at gate 2, which a prompt
 * invented from the topic does not.
 */
export function seedsFromSearchConsole(
  rows: { query: string; impressions: number }[],
  limit = 40,
): PromptSeed[] {
  return [...rows]
    .filter((row) => row.query.trim() !== '' && row.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map((row) => ({
      text: row.query.trim(),
      cluster: headTerm(row.query),
      impressions: row.impressions,
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
