import type { SampledPrompt } from '../runner/sample.js';
import type { ProjectContext } from '../lib/citations.js';
import {
  ANSWER_MAX_WORDS,
  ANSWER_MIN_WORDS,
  bestPassage,
  hasSchemaType,
  hasSnippetSuppression,
  visibleText,
  wordCount,
} from '../lib/html.js';
import { blockedCrawlersFor, ENGINE_CRAWLERS, parseRobots } from '../lib/robots.js';
import type { DetectionResult, Gap, PageEvidence, SiteEvidence } from './types.js';

/** Below this term overlap the passage is not about the prompt. */
const PASSAGE_MIN_OVERLAP = 0.4;
/** Raw HTML below this and the crawler is seeing almost nothing. */
const JS_ONLY_RAW_WORDS = 200;
/**
 * Rendered words needed before "there is real content here" is a fair claim:
 * four times the answer band's minimum, so the page holds an extractable
 * passage and some context around it.
 */
const JS_ONLY_RENDERED_WORDS = ANSWER_MIN_WORDS * 4;
/**
 * How many times bigger the rendered text must be than the raw.
 *
 * The ratio is the signal, not an absolute size. An earlier fixed floor of 800
 * rendered words only caught large JavaScript pages and silently missed
 * ordinary product pages, which is most of them — a page whose raw HTML holds
 * twenty words and whose rendered DOM holds three hundred is exactly as
 * invisible to a crawler as one holding three thousand.
 */
const JS_ONLY_RATIO = 5;
/** Fewer inbound internal links than this and the page is effectively orphaned. */
const ORPHAN_LINK_THRESHOLD = 3;
/** Past this classic position, no on-page work will get the page retrieved. */
const RANK_CEILING = 20;
/** Third-party domains backing a rival before we call the topic corroborated. */
const CORROBORATION_THRESHOLD = 3;

const DEFAULT_SCHEMA_TYPES = ['Product', 'FAQPage', 'Article'];

/**
 * Turn one sampled prompt into the gaps that explain why the brand was not
 * cited.
 *
 * Two states produce no gaps at all, and the distinction is the whole reason
 * `SampledPrompt` tracks them separately:
 *
 * - `cited` — nothing to fix.
 * - `unknown` — every call failed, so we observed nothing. Emitting gaps here
 *   would invent work from an outage, and because actions cost the customer
 *   real content changes, that is worse than reporting nothing. The same rule
 *   applies to `evidence.siteUnreachable`.
 *
 * `contested` does produce gaps: being cited one time in three is a real
 * weakness, not a win.
 */
export function detectGaps(
  sampled: SampledPrompt,
  context: ProjectContext,
  evidence: SiteEvidence,
): DetectionResult {
  if (sampled.verdict === 'cited' || sampled.verdict === 'unknown') {
    return { gaps: [], blocking: null };
  }

  // Same principle one layer down: a crawl that reached nothing tells us
  // nothing about the site.
  if (evidence.siteUnreachable === true) {
    return { gaps: [], blocking: null };
  }

  const gaps: Gap[] = [];
  const base = { prompt: sampled.prompt, engine: sampled.engine };
  const page = evidence.candidatePage;

  // ── Gate 1: retrievable ────────────────────────────────────────────────────

  if (page === null) {
    gaps.push({
      ...base,
      gapType: 'no_page',
      blockedAtGate: 1,
      ourUrl: null,
      rivalUrl: firstRivalUrl(sampled),
      certainty: 'proven',
      evidence: { reason: 'no owned page is topically close to this prompt' },
    });
  } else {
    const path = pathOf(page.url);

    if (evidence.robotsTxt !== null) {
      const blocked = blockedCrawlersFor(parseRobots(evidence.robotsTxt), sampled.engine, path);
      if (blocked.length > 0) {
        gaps.push({
          ...base,
          gapType: 'bot_blocked',
          blockedAtGate: 1,
          ourUrl: page.url,
          rivalUrl: firstRivalUrl(sampled),
          certainty: 'proven',
          evidence: {
            reason: 'robots.txt disallows a crawler this engine needs',
            userAgents: blocked.map((b) => b.userAgent),
            path,
            layer: 'robots',
          },
        });
      }
    }

    // Edge blocking is invisible to robots.txt: a permissive robots.txt and a
    // CDN returning 403 to OAI-SearchBot look identical until something sends
    // that user-agent. Reported separately so the fix goes to the right place
    // -- a WAF rule, not a robots.txt edit.
    const edgeBlocked = (evidence.edgeBlockedCrawlers ?? []).filter((bot) =>
      ENGINE_CRAWLERS[sampled.engine]?.required.includes(bot) === true,
    );
    if (edgeBlocked.length > 0) {
      gaps.push({
        ...base,
        gapType: 'bot_blocked',
        blockedAtGate: 1,
        ourUrl: page.url,
        rivalUrl: firstRivalUrl(sampled),
        certainty: 'proven',
        evidence: {
          reason: 'the site edge blocks a crawler this engine needs, despite robots.txt',
          userAgents: edgeBlocked,
          layer: 'edge',
        },
      });
    }

    // Snippet suppression is a separate mechanism from robots.txt and only
    // binds on Google surfaces, where it is the one control that removes a page
    // from AI Overviews.
    if ((sampled.engine === 'aio' || sampled.engine === 'gemini') && hasSnippetSuppression(page.html)) {
      gaps.push({
        ...base,
        gapType: 'bot_blocked',
        blockedAtGate: 1,
        ourUrl: page.url,
        rivalUrl: firstRivalUrl(sampled),
        certainty: 'proven',
        evidence: {
          reason: 'meta robots nosnippet or max-snippet:0 blocks this page from AI Overviews',
          path,
        },
      });
    }

    const rawWords = wordCount(visibleText(page.html));
    if (
      page.renderedWords !== undefined &&
      rawWords < JS_ONLY_RAW_WORDS &&
      page.renderedWords >= JS_ONLY_RENDERED_WORDS &&
      page.renderedWords >= rawWords * JS_ONLY_RATIO
    ) {
      gaps.push({
        ...base,
        gapType: 'js_only',
        blockedAtGate: 1,
        ourUrl: page.url,
        rivalUrl: firstRivalUrl(sampled),
        certainty: 'proven',
        evidence: {
          reason: 'content exists only after JavaScript runs',
          rawWords,
          renderedWords: page.renderedWords,
          ratio: Number((page.renderedWords / Math.max(1, rawWords)).toFixed(1)),
        },
      });
    }
  }

  // ── Gate 2: ranked ─────────────────────────────────────────────────────────
  //
  // Advisory only. When the page cannot reach the top of classic results, no
  // amount of generated content will get it retrieved, so the honest output is
  // to say so rather than to bill for a block nobody will read.

  if (page !== null && page.organicPosition !== undefined && page.organicPosition > RANK_CEILING) {
    gaps.push({
      ...base,
      gapType: 'not_ranking',
      blockedAtGate: 2,
      ourUrl: page.url,
      rivalUrl: firstRivalUrl(sampled),
      certainty: 'proven',
      evidence: {
        reason: 'page ranks below the range engines retrieve from',
        organicPosition: page.organicPosition,
        ceiling: RANK_CEILING,
      },
    });
  }

  // ── Gate 3: extractable ────────────────────────────────────────────────────

  if (page !== null) {
    gaps.push(...gate3Gaps(base, page, sampled));
  }

  // ── Gate 4: corroborated ───────────────────────────────────────────────────

  if (
    sampled.competitorDomainsCited.length > 0 &&
    sampled.thirdPartyDomains.length >= CORROBORATION_THRESHOLD
  ) {
    gaps.push({
      ...base,
      gapType: 'rival_corroborated',
      blockedAtGate: 4,
      ourUrl: page?.url ?? null,
      rivalUrl: firstRivalUrl(sampled),
      certainty: 'proven',
      evidence: {
        reason: 'the sources this engine trusts for the topic back a competitor',
        competitorDomains: sampled.competitorDomainsCited,
        placementTargets: sampled.thirdPartyDomains,
        selfDomain: context.domain,
      },
    });
  }

  const ordered = [...gaps].sort((a, b) => a.blockedAtGate - b.blockedAtGate);
  return { gaps: ordered, blocking: ordered[0] ?? null };
}

function gate3Gaps(
  base: { prompt: string; engine: string },
  page: PageEvidence,
  sampled: SampledPrompt,
): Gap[] {
  const out: Gap[] = [];
  const rivalUrl = firstRivalUrl(sampled);

  const passage = bestPassage(page.html, sampled.prompt);
  // `inBand` already encodes the length test, and `bestPassage` only falls
  // back to an out-of-band passage when the page has no answerable one at all.
  const weak = passage === null || !passage.inBand || passage.overlap < PASSAGE_MIN_OVERLAP;

  if (weak) {
    out.push({
      ...base,
      gapType: 'weak_passage',
      blockedAtGate: 3,
      ourUrl: page.url,
      rivalUrl,
      certainty: 'proven',
      evidence: {
        reason: 'no self-contained passage on the page answers this prompt',
        ...(passage === null
          ? { bestPassage: null }
          : {
              bestPassageWords: passage.words,
              bestPassageOverlap: Number(passage.overlap.toFixed(2)),
              bestPassageText: passage.text.slice(0, 400),
            }),
        wantWords: [ANSWER_MIN_WORDS, ANSWER_MAX_WORDS],
      },
    });
  }

  const expected = page.expectedSchemaTypes ?? DEFAULT_SCHEMA_TYPES;
  if (!hasSchemaType(page.html, expected)) {
    out.push({
      ...base,
      gapType: 'no_schema',
      blockedAtGate: 3,
      ourUrl: page.url,
      rivalUrl,
      // Structured data aids entity resolution but has never been confirmed as
      // a retrieval input. Labelled `strong`, not `proven`, and the UI shows
      // that label so the customer can price the work accordingly.
      certainty: 'strong',
      evidence: { reason: 'page carries none of the expected schema types', expected },
    });
  }

  if (
    page.internalInboundLinks !== undefined &&
    page.internalInboundLinks < ORPHAN_LINK_THRESHOLD
  ) {
    out.push({
      ...base,
      gapType: 'orphan',
      blockedAtGate: 3,
      ourUrl: page.url,
      rivalUrl,
      certainty: 'strong',
      evidence: {
        reason: 'page has too few internal inbound links to be crawled reliably',
        internalInboundLinks: page.internalInboundLinks,
        threshold: ORPHAN_LINK_THRESHOLD,
      },
    });
  }

  return out;
}

function firstRivalUrl(sampled: SampledPrompt): string | null {
  for (const attempt of sampled.attempts) {
    const competitor = attempt.analysis?.citations.find((c) => c.owner === 'competitor');
    if (competitor !== undefined) return competitor.url;
  }
  return null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}
