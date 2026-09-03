import { contentWords, visibleText, wordCount } from '../lib/html.js';
import type { PageEvidence, SiteEvidence } from '../gaps/types.js';
import { firstHeadingOf, titleOf } from './links.js';
import type { CrawledPage, SiteIndex } from './crawl.js';

/**
 * Below this score no page on the site is really about the prompt, and the
 * honest output is `no_page` rather than the least-bad match. Handing the
 * generator a page that only loosely relates to the question is how a tool
 * ends up bolting an unrelated FAQ onto a product page.
 */
const CANDIDATE_FLOOR = 0.3;

/**
 * How much a prompt term counts for, by where on the page it appears.
 *
 * The score is the mean of these across the prompt's terms, so a page covering
 * every term in its title scores 1 and a page mentioning half of them in the
 * body scores around 0.3. The earlier formula summed weighted per-field overlap
 * instead, which could only clear the floor when the title restated the whole
 * question — something real product titles never do, so genuinely relevant
 * pages were being rejected as `no_page`.
 */
const PROMINENCE = { title: 1, heading: 0.9, url: 0.7, body: 0.6 } as const;

/** Raw word count below which a page's content is probably behind JavaScript. */
const THIN_RAW_WORDS = 200;
/** Pages rendered when raw scoring finds nothing. Each render costs a browser page. */
const RENDER_CANDIDATES = 3;

export interface EvidenceOptions {
  /**
   * Returns the page's HTML after JavaScript runs. Wire this to a headless
   * browser to enable `js_only` detection; without it that gap cannot be
   * distinguished from a genuinely thin page and is simply not reported.
   *
   * It returns HTML rather than a word count on purpose. The detector compares
   * raw words against rendered words, and a count produced by a different
   * method — counting DOM text nodes, say — is not comparable to the one taken
   * from the raw HTML. Returning markup and counting both sides with the same
   * function makes the comparison correct by construction rather than by
   * whoever wires the renderer remembering to match it.
   */
  renderHtml?: (url: string) => Promise<string | null>;
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
    .map((page) => ({ page, score: scorePage(page, terms, page.html) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Score a page against the prompt using one HTML source for every field.
 *
 * Title and heading are read out of `html` rather than off the crawled record.
 * For the raw pass that is identical — the record was built from the same
 * markup — but for a rendered pass it is the difference between working and
 * not: a JavaScript-rendered page's `<h1>` only exists after hydration, and
 * scoring the rendered body against the empty raw heading leaves the page
 * short of the floor for a reason that has nothing to do with relevance.
 */
function scorePage(page: CrawledPage, terms: string[], html: string): number {
  if (terms.length === 0) return 0;

  const fields = {
    title: new Set(contentWords(titleOf(html) ?? '')),
    heading: new Set(contentWords(firstHeadingOf(html) ?? '')),
    url: new Set(contentWords(slugWords(page.url))),
    body: new Set(contentWords(html)),
  };

  let total = 0;
  for (const term of terms) {
    // A term counts once, at the most prominent place it appears.
    if (fields.title.has(term)) total += PROMINENCE.title;
    else if (fields.heading.has(term)) total += PROMINENCE.heading;
    else if (fields.url.has(term)) total += PROMINENCE.url;
    else if (fields.body.has(term)) total += PROMINENCE.body;
  }

  return total / terms.length;
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

  const ranked = rankCandidates(index, prompt);
  let best = ranked[0];
  let renderedHtml: string | null = null;

  /*
   * A JavaScript-rendered site hides its content from raw scoring entirely, so
   * every page scores near zero and the honest-looking answer is `no_page` —
   * "you have no page about this". That is wrong, and it hides the one gap type
   * that exists for exactly this case: the page is there, the engine just
   * cannot see it either.
   *
   * When nothing clears the floor and a renderer is wired, the thinnest few
   * candidates are rendered and re-scored. `candidatePage.html` still holds the
   * raw markup, because that is the side the detector compares against.
   */
  if (options.renderHtml !== undefined && (best === undefined || best.score < CANDIDATE_FLOOR)) {
    const terms = contentWords(prompt);
    const suspects = ranked.filter((c) => c.page.words < THIN_RAW_WORDS).slice(0, RENDER_CANDIDATES);

    for (const suspect of suspects) {
      let html: string | null = null;
      try {
        html = await options.renderHtml(suspect.page.finalUrl);
      } catch {
        continue;
      }
      if (html === null) continue;

      const score = scorePage(suspect.page, terms, html);
      if (score >= CANDIDATE_FLOOR && (best === undefined || score > best.score)) {
        best = { page: suspect.page, score };
        renderedHtml = html;
      }
    }
  }

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

  if (renderedHtml !== null) {
    // Already rendered while rescuing the candidate; do not pay for it twice.
    candidatePage.renderedWords = wordCount(visibleText(renderedHtml));
  } else if (options.renderHtml !== undefined) {
    try {
      const rendered = await options.renderHtml(page.finalUrl);
      if (rendered !== null) {
        candidatePage.renderedWords = wordCount(visibleText(rendered));
      }
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
