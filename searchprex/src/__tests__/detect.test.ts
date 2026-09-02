import { describe, expect, it } from 'vitest';
import { detectGaps } from '../gaps/detect.js';
import type { SampledPrompt } from '../runner/sample.js';
import type { ProjectContext } from '../lib/citations.js';
import type { SiteEvidence } from '../gaps/types.js';

const context: ProjectContext = {
  domain: 'smkstore.com',
  brandNames: ['SMK Store'],
  competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
};

const PROMPT = 'how long does a barlow knife blade stay sharp';

const GOOD_PAGE_HTML = `
  <html><head>
    <script type="application/ld+json">{"@type":"Product","name":"Barlow"}</script>
  </head><body>
    <h2>How long does a barlow knife blade stay sharp?</h2>
    <p>A barlow knife blade in 1095 carbon steel stays sharp for roughly two weeks
       of daily cutting before it needs a strop, and about six weeks before a full
       sharpen. We test every blade in store before it ships from Michigan.</p>
  </body></html>`;

function sampled(overrides: Partial<SampledPrompt> = {}): SampledPrompt {
  return {
    engine: 'perplexity',
    prompt: PROMPT,
    attempts: [],
    succeeded: 3,
    citedCount: 0,
    mentionedCount: 0,
    verdict: 'absent',
    thirdPartyDomains: [],
    competitorDomainsCited: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<SiteEvidence> = {}): SiteEvidence {
  return {
    robotsTxt: 'User-agent: *\nAllow: /\n',
    candidatePage: {
      url: 'https://smkstore.com/products/barlow',
      httpStatus: 200,
      html: GOOD_PAGE_HTML,
    },
    ...overrides,
  };
}

describe('detectGaps — states that must produce nothing', () => {
  it('emits no gaps when the brand is cited every time', () => {
    const result = detectGaps(sampled({ verdict: 'cited', citedCount: 3 }), context, evidence());
    expect(result.gaps).toEqual([]);
    expect(result.blocking).toBeNull();
  });

  it('emits no gaps when every call failed', () => {
    // An outage is not evidence of absence. Generating work from it would bill
    // the customer for a gap nobody observed.
    const result = detectGaps(
      sampled({ verdict: 'unknown', succeeded: 0 }),
      context,
      evidence({ candidatePage: null }),
    );
    expect(result.gaps).toEqual([]);
  });

  it('does emit gaps for a contested verdict', () => {
    // Cited one time in three is a weakness, not a win.
    const result = detectGaps(
      sampled({ verdict: 'contested', citedCount: 1 }),
      context,
      evidence({ robotsTxt: 'User-agent: PerplexityBot\nDisallow: /\n' }),
    );
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});

describe('detectGaps — gate 1', () => {
  it('detects a blocked required crawler', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({ robotsTxt: 'User-agent: PerplexityBot\nDisallow: /products/\n' }),
    );
    const gap = result.gaps.find((g) => g.gapType === 'bot_blocked')!;
    expect(gap.blockedAtGate).toBe(1);
    expect(gap.certainty).toBe('proven');
    expect(gap.evidence['userAgents']).toEqual(['PerplexityBot']);
  });

  it('does not report bot_blocked for a training-only crawler', () => {
    const result = detectGaps(
      sampled({ engine: 'openai' }),
      context,
      evidence({ robotsTxt: 'User-agent: GPTBot\nDisallow: /\n' }),
    );
    expect(result.gaps.some((g) => g.gapType === 'bot_blocked')).toBe(false);
  });

  it('detects no_page when nothing owned is close to the prompt', () => {
    const result = detectGaps(sampled(), context, evidence({ candidatePage: null }));
    expect(result.blocking!.gapType).toBe('no_page');
    expect(result.blocking!.ourUrl).toBeNull();
  });

  it('detects a JS-only page', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/products/barlow',
          httpStatus: 200,
          html: '<html><body><div id="root"></div></body></html>',
          renderedWords: 1200,
        },
      }),
    );
    const gap = result.gaps.find((g) => g.gapType === 'js_only')!;
    expect(gap.blockedAtGate).toBe(1);
    expect(gap.evidence['renderedWords']).toBe(1200);
  });

  it('treats nosnippet as an AI Overviews block but not a Perplexity one', () => {
    const html = `<meta name="robots" content="nosnippet">${GOOD_PAGE_HTML}`;
    const page = { url: 'https://smkstore.com/p', httpStatus: 200, html };

    const aio = detectGaps(sampled({ engine: 'aio' }), context, evidence({ candidatePage: page }));
    expect(aio.gaps.some((g) => g.gapType === 'bot_blocked')).toBe(true);

    const pplx = detectGaps(sampled(), context, evidence({ candidatePage: page }));
    expect(pplx.gaps.some((g) => g.gapType === 'bot_blocked')).toBe(false);
  });
});

describe('detectGaps — gate 2', () => {
  it('raises not_ranking rather than content work when the page ranks too low', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/products/barlow',
          httpStatus: 200,
          html: GOOD_PAGE_HTML,
          organicPosition: 41,
        },
      }),
    );
    const gap = result.gaps.find((g) => g.gapType === 'not_ranking')!;
    expect(gap.blockedAtGate).toBe(2);
    expect(gap.evidence['organicPosition']).toBe(41);
  });

  it('does not raise not_ranking for a page inside the retrieval range', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/products/barlow',
          httpStatus: 200,
          html: GOOD_PAGE_HTML,
          organicPosition: 7,
        },
      }),
    );
    expect(result.gaps.some((g) => g.gapType === 'not_ranking')).toBe(false);
  });
});

describe('detectGaps — gate 3', () => {
  it('passes a page that already has a self-contained answer and schema', () => {
    const result = detectGaps(sampled(), context, evidence());
    expect(result.gaps.some((g) => g.gapType === 'weak_passage')).toBe(false);
    expect(result.gaps.some((g) => g.gapType === 'no_schema')).toBe(false);
  });

  it('flags a wall of text as a weak passage', () => {
    const wall = `barlow knife blade stay sharp ${'and more filler copy '.repeat(60)}`;
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/p',
          httpStatus: 200,
          html: `<script type="application/ld+json">{"@type":"Product"}</script><p>${wall}</p>`,
        },
      }),
    );
    const gap = result.gaps.find((g) => g.gapType === 'weak_passage')!;
    expect(gap.evidence['bestPassageWords']).toBeGreaterThan(90);
  });

  it('flags a page with no relevant passage at all', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/p',
          httpStatus: 200,
          html: '<p>Free shipping on all orders over fifty dollars, every single day.</p>',
        },
      }),
    );
    expect(result.gaps.some((g) => g.gapType === 'weak_passage')).toBe(true);
  });

  it('labels missing schema as strong, not proven', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: { url: 'https://smkstore.com/p', httpStatus: 200, html: '<p>x</p>' },
      }),
    );
    const gap = result.gaps.find((g) => g.gapType === 'no_schema')!;
    expect(gap.certainty).toBe('strong');
  });

  it('flags an orphaned page', () => {
    const result = detectGaps(
      sampled(),
      context,
      evidence({
        candidatePage: {
          url: 'https://smkstore.com/p',
          httpStatus: 200,
          html: GOOD_PAGE_HTML,
          internalInboundLinks: 1,
        },
      }),
    );
    expect(result.gaps.some((g) => g.gapType === 'orphan')).toBe(true);
  });
});

describe('detectGaps — gate 4', () => {
  it('detects rival corroboration and carries the placement targets', () => {
    const result = detectGaps(
      sampled({
        competitorDomainsCited: ['bladehq.com'],
        thirdPartyDomains: ['reddit.com', 'youtube.com', 'knifeforums.com'],
      }),
      context,
      evidence(),
    );
    const gap = result.gaps.find((g) => g.gapType === 'rival_corroborated')!;
    expect(gap.blockedAtGate).toBe(4);
    expect(gap.evidence['placementTargets']).toEqual([
      'reddit.com',
      'youtube.com',
      'knifeforums.com',
    ]);
  });

  it('does not fire below the corroboration threshold', () => {
    const result = detectGaps(
      sampled({ competitorDomainsCited: ['bladehq.com'], thirdPartyDomains: ['reddit.com'] }),
      context,
      evidence(),
    );
    expect(result.gaps.some((g) => g.gapType === 'rival_corroborated')).toBe(false);
  });
});

describe('detectGaps — ordering', () => {
  it('returns the earliest-gate gap as blocking', () => {
    // A page that is blocked in robots AND thin AND out-ranked: only the
    // robots fix can pay off, so generating a block first would be waste.
    const result = detectGaps(
      sampled({
        competitorDomainsCited: ['bladehq.com'],
        thirdPartyDomains: ['reddit.com', 'youtube.com', 'knifeforums.com'],
      }),
      context,
      evidence({
        robotsTxt: 'User-agent: PerplexityBot\nDisallow: /\n',
        candidatePage: { url: 'https://smkstore.com/p', httpStatus: 200, html: '<p>thin</p>' },
      }),
    );

    expect(result.blocking!.gapType).toBe('bot_blocked');
    expect(result.gaps.map((g) => g.blockedAtGate)).toEqual(
      [...result.gaps.map((g) => g.blockedAtGate)].sort((a, b) => a - b),
    );
  });
});
