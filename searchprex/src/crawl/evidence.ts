import { contentWords } from '../lib/html.js';
import type { PageEvidence, SiteEvidence } from '../gaps/types.js';
import type { CrawledPage, SiteIndex } from './crawl.js';

/**
 * Below this score no page on the site is really about the prompt, and the
 * honest output is `no_page` rather than the least-bad match. Handing the
 * generator a page that only loosely relates to the question is how a tool
 * ends up bolting an unrelated FAQ onto a product page.
 */
const CANDIDATE_FLOOR = 0.3;

const WEIGHTS = { title: 0.35, heading: 0.25, url: 0.15, body: 0.25 } as const;

export interface EvidenceOptions {
  /**
   * Returns the word count of the page after JavaScript runs. Wire this to a
   * headless browser to enable `js_only` detection; without it that gap cannot
   * be distinguished from a genuinely thin page and is simply not reported.
   */
  renderer?: (url: string) => Promise<number>;
  /** Classic organic position for this prompt, when a rank source is wired. */
  organicPosition?: number;
}

export interface ScoredPage {
  page: CrawledPage;
  score: number;
}

/** Score every crawled page against the prompt, best first. */
export function rankCandidates(index: SiteIndex, prompt: string): ScoredPage[] {
  const terms = contentWords(prompt);
  if (terms.length === 0) return [];

  return index.pages
    .map((page) => ({ page, score: scorePage(page, terms) }))
    .sort((a, b) => b.score - a.score);
}

function scorePage(page: CrawledPage, terms: string[]): number {
  const overlap = (text: string | null): number => {
    if (text === null || text === '') return 0;
    const words = contentWords(text);
    return terms.filter((t) => words.includes(t)).length / terms.length;
  };

  return (
    WEIGHTS.title * overlap(page.title) +
    WEIGHTS.heading * overlap(page.heading) +
    WEIGHTS.url * overlap(slugWords(page.url)) +
    WEIGHTS.body * overlap(page.html)
  );
}

function slugWords(url: string): string {
  try {
    return new URL(url).pathname.replace(/[-_/]+/g, ' ');
  } catch {
    return url.replace(/[-_/]+/g, ' ');
  }
}

/**
 * Product pages want Product markup; everything else is an article or an FAQ.
 * A heuristic on the URL, not a claim about the page type — it only decides
 * which schema types `no_schema` looks for.
 */
export function inferSchemaTypes(url: string): string[] {
  return /\/(?:products?|p|item|sku)\//i.test(url)
    ? ['Product']
    : ['FAQPage', 'Article', 'BlogPosting'];
}

/** Assemble the evidence the gap detector consumes for one prompt. */
export async function buildSiteEvidence(
  index: SiteIndex,
  prompt: string,
  options: EvidenceOptions = {},
): Promise<SiteEvidence> {
  const edgeBlockedCrawlers = index.crawlerProbes
    .filter((probe) => probe.blocked)
    .map((probe) => probe.userAgent);

  if (!index.reachable) {
    return { robotsTxt: null, candidatePage: null, siteUnreachable: true };
  }

  const best = rankCandidates(index, prompt)[0];

  if (best === undefined || best.score < CANDIDATE_FLOOR) {
    return {
      robotsTxt: index.robotsTxt,
      candidatePage: null,
      ...(edgeBlockedCrawlers.length > 0 ? { edgeBlockedCrawlers } : {}),
    };
  }

  const page = best.page;
  const candidatePage: PageEvidence = {
    url: page.finalUrl,
    httpStatus: page.status,
    html: page.html,
    internalInboundLinks: page.internalInboundLinks,
    expectedSchemaTypes: inferSchemaTypes(page.finalUrl),
    ...(options.organicPosition === undefined
      ? {}
      : { organicPosition: options.organicPosition }),
  };

  if (options.renderer !== undefined) {
    try {
      candidatePage.renderedWords = await options.renderer(page.finalUrl);
    } catch {
      // A renderer failure means js_only cannot be judged for this page. That
      // is a missing signal, not evidence the page is fine, so it is simply
      // left unset rather than defaulted.
    }
  }

  return {
    robotsTxt: index.robotsTxt,
    candidatePage,
    ...(edgeBlockedCrawlers.length > 0 ? { edgeBlockedCrawlers } : {}),
  };
}
