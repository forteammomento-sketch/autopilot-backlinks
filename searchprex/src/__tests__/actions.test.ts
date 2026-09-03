import { describe, expect, it, vi } from 'vitest';
import { generateActions } from '../actions/generate.js';
import { generateAnswerBlock, relevantFacts, shingleContainment } from '../actions/answer-block.js';
import { buildCrawlFix, buildSchema, buildInternalLink } from '../actions/artifacts.js';
import { priorityFor } from '../actions/rank.js';
import type { AnswerBlockWriter } from '../actions/answer-block.js';
import type { Fact } from '../actions/types.js';
import type { DetectionResult, Gap } from '../gaps/types.js';

const PROMPT = 'how long does a barlow knife blade stay sharp';

const FACTS: Fact[] = [
  { claim: 'blade steel', value: '1095 carbon steel', topic: ['blade', 'sharp'], source: 'catalog' },
  { claim: 'edge retention', value: 'two weeks', topic: ['sharp', 'blade'], source: 'in-store testing' },
  { claim: 'price', value: '$39', topic: ['cost'], source: 'catalog' },
];

function gap(overrides: Partial<Gap> = {}): Gap {
  return {
    prompt: PROMPT,
    engine: 'perplexity',
    gapType: 'weak_passage',
    blockedAtGate: 3,
    ourUrl: 'https://michigansportsoutdoor.com/products/barlow',
    rivalUrl: 'https://bladehq.com/barlow',
    certainty: 'proven',
    evidence: { reason: 'no self-contained passage' },
    ...overrides,
  };
}

function detection(gaps: Gap[]): DetectionResult {
  const ordered = [...gaps].sort((a, b) => a.blockedAtGate - b.blockedAtGate);
  return { gaps: ordered, blocking: ordered[0] ?? null };
}

const goodWriter: AnswerBlockWriter = {
  write: async () => ({
    answer:
      'A barlow blade in 1095 carbon steel holds a working edge for about two weeks ' +
      'of daily cutting before it needs a strop, and roughly six weeks before a full ' +
      'sharpen. We test every blade in store before it ships, so the edge you receive ' +
      'is the edge we measured on that batch rather than a factory average.',
    supporting: ['Blade steel: 1095 carbon steel', 'Tested in store before dispatch'],
  }),
};

function options(writer: AnswerBlockWriter = goodWriter) {
  return { brandName: 'Michigan Sports Outdoor', facts: FACTS, writer };
}

describe('relevantFacts', () => {
  it('matches on what a fact is about, not its value', () => {
    // "$39" shares no words with any question, but it is exactly the kind of
    // specific an answer needs — so relevance is judged on claim and topic.
    const facts = relevantFacts(PROMPT, FACTS);
    expect(facts.map((f) => f.claim)).toEqual(['blade steel', 'edge retention']);
  });

  it('returns nothing when no fact bears on the prompt', () => {
    expect(relevantFacts('what is your returns policy', FACTS)).toEqual([]);
  });
});

describe('generateAnswerBlock — refusal', () => {
  it('refuses when there are no first-party facts, without calling the writer', async () => {
    // The rule the whole engine turns on: with nothing of our own to say, any
    // block would restate the competitor page that is already cited.
    const writer = { write: vi.fn() } as unknown as AnswerBlockWriter;
    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: [], rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      writer,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_first_party_facts');
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('refuses a block that uses none of the supplied facts', async () => {
    const vague: AnswerBlockWriter = {
      write: async () => ({
        answer:
          'Knife blades stay sharp for a while depending on how you use them and what ' +
          'you cut. Good quality knives generally last longer between sharpenings than ' +
          'cheaper ones, so it really does vary quite a lot between different users.',
        supporting: [],
      }),
    };
    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      vague,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation_failed');
      expect(result.failures).toContain('no_fact_used');
    }
  });

  it('refuses a block that restates the already-cited rival passage', async () => {
    const rival =
      'A barlow blade in 1095 carbon steel holds a working edge for about two weeks ' +
      'of daily cutting before it needs a strop, and roughly six weeks before a full sharpen.';

    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: rival, existingPassage: null, brandName: 'MSO' },
      goodWriter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate_of_existing');
  });

  it('refuses a near-duplicate of a block already deployed on the site', async () => {
    const existing =
      'A barlow blade in 1095 carbon steel holds a working edge for about two weeks of ' +
      'daily cutting before it needs a strop, and roughly six weeks before a full sharpen.';

    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      goodWriter,
      { existingBlocks: [existing] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures).toContain('duplicate');
  });

  it('refuses an answer outside the retrievable length band', async () => {
    const short: AnswerBlockWriter = {
      write: async () => ({ answer: 'About two weeks with 1095 carbon steel.', supporting: [] }),
    };
    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      short,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures).toContain('too_short');
  });

  it('retries once before refusing', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ answer: 'too short', supporting: [] })
      .mockResolvedValueOnce(await goodWriter.write({} as never));

    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      { write },
    );

    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe('generateAnswerBlock — success', () => {
  it('produces a block that names the facts it used', async () => {
    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      goodWriter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.factsUsed).toEqual(['blade steel', 'edge retention']);
    expect(result.artifact.question).toBe('How long does a barlow knife blade stay sharp?');
    expect(result.artifact.html).toContain('<h2>');
    expect(result.artifact.html).toContain('1095 carbon steel');
  });

  it('escapes HTML in generated copy', async () => {
    const nasty: AnswerBlockWriter = {
      write: async () => ({
        answer:
          'A barlow blade in 1095 carbon steel <script>alert(1)</script> holds an edge for ' +
          'about two weeks of daily cutting before it needs a strop, and roughly six weeks ' +
          'before it needs a full sharpen on a stone in the workshop out back.',
        supporting: [],
      }),
    };
    const result = await generateAnswerBlock(
      { prompt: PROMPT, facts: FACTS, rivalPassage: null, existingPassage: null, brandName: 'MSO' },
      nasty,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.html).not.toContain('<script>');
  });
});

describe('deterministic artifacts', () => {
  it('writes a robots.txt allow group for a robots-level block', () => {
    const artifact = buildCrawlFix(
      gap({
        gapType: 'bot_blocked',
        blockedAtGate: 1,
        evidence: { layer: 'robots', userAgents: ['PerplexityBot'], reason: 'blocked' },
      }),
    );
    expect(artifact.layer).toBe('robots');
    expect(artifact.robotsAdditions).toEqual(['User-agent: PerplexityBot', 'Allow: /', '']);
  });

  it('sends an edge block to the WAF, not to robots.txt', () => {
    const artifact = buildCrawlFix(
      gap({
        gapType: 'bot_blocked',
        blockedAtGate: 1,
        evidence: { layer: 'edge', userAgents: ['OAI-SearchBot'], reason: 'blocked' },
      }),
    );
    expect(artifact.robotsAdditions).toEqual([]);
    expect(artifact.note).toContain('WAF or CDN');
  });

  it('never invents a price in Product schema', () => {
    // Product markup carrying a price the page does not show is a
    // structured-data violation and a manual-action risk.
    const withoutPrice = buildSchema({
      url: 'https://mso.com/products/barlow',
      html: '<h1>Rough Rider Barlow</h1>',
      brandName: 'MSO',
      types: ['Product'],
      facts: [FACTS[0]!],
    });
    expect(withoutPrice.jsonLd['offers']).toBeUndefined();
    expect(withoutPrice.jsonLd['name']).toBe('Rough Rider Barlow');

    const withPrice = buildSchema({
      url: 'https://mso.com/products/barlow',
      html: '<h1>Rough Rider Barlow</h1>',
      brandName: 'MSO',
      types: ['Product'],
      facts: FACTS,
    });
    expect((withPrice.jsonLd['offers'] as Record<string, unknown>)['price']).toBe('39');
  });

  it('suggests descriptive anchors and excludes the target from its own sources', () => {
    const target = 'https://mso.com/products/barlow';
    const artifact = buildInternalLink(gap(), target, [
      { url: target, title: 'self' },
      { url: 'https://mso.com/collections/knives', title: 'Knives' },
    ]);
    expect(artifact.sourceUrls).toEqual(['https://mso.com/collections/knives']);
    expect(artifact.anchors[0]).toBe('long does a barlow knife blade stay sharp');
  });
});

describe('priorityFor', () => {
  it('discounts a recommendation we cannot prove', () => {
    const proven = priorityFor({ actionType: 'schema', certainty: 'proven' });
    const strong = priorityFor({ actionType: 'schema', certainty: 'strong' });
    expect(strong).toBeLessThan(proven);
  });

  it('keeps the advisory below work that changes something', () => {
    const advisory = priorityFor({ actionType: 'rank_first', certainty: 'proven' });
    const fix = priorityFor({ actionType: 'crawl_fix', certainty: 'proven' });
    expect(advisory).toBeLessThan(fix);
  });

  it('defaults an unmeasured action type to the middle rather than the top', () => {
    const unknown = priorityFor({ actionType: 'answer_block', certainty: 'proven' });
    const winning = priorityFor({
      actionType: 'answer_block',
      certainty: 'proven',
      historicalWinRate: 0.9,
    });
    expect(unknown).toBeLessThan(winning);
  });
});

describe('generateActions', () => {
  it('refuses a content action when the page is not retrievable', async () => {
    const blocked = gap({
      gapType: 'bot_blocked',
      blockedAtGate: 1,
      evidence: { layer: 'robots', userAgents: ['PerplexityBot'], reason: 'blocked' },
    });
    const outcomes = await generateActions([detection([blocked, gap()])], options());

    const refusal = outcomes.find((o) => o.kind === 'refused');
    expect(refusal).toBeDefined();
    if (refusal?.kind === 'refused') {
      expect(refusal.refusal.reason).toBe('not_retrievable');
      expect(refusal.refusal.needed).toContain('crawler block');
    }

    // The cheap deterministic fix is still produced.
    expect(outcomes.some((o) => o.kind === 'action' && o.action.actionType === 'crawl_fix')).toBe(true);
    expect(outcomes.some((o) => o.kind === 'action' && o.action.actionType === 'answer_block')).toBe(false);
  });

  it('generates a content action once the blocking gap is at gate 3', async () => {
    const outcomes = await generateActions([detection([gap()])], options());
    const action = outcomes.find((o) => o.kind === 'action' && o.action.actionType === 'answer_block');
    expect(action).toBeDefined();
  });

  it('still writes a block for no_page, whose remedy is the page itself', async () => {
    // no_page sits at gate 1, but refusing it as "not retrievable" would be
    // circular: writing the page is the fix.
    const outcomes = await generateActions(
      [detection([gap({ gapType: 'no_page', blockedAtGate: 1, ourUrl: null })])],
      options(),
    );
    const action = outcomes.find((o) => o.kind === 'action' && o.action.actionType === 'answer_block');
    expect(action).toBeDefined();
  });

  it('emits rank_first as an advisory with no artifact', async () => {
    const outcomes = await generateActions(
      [detection([gap({ gapType: 'not_ranking', blockedAtGate: 2, evidence: { organicPosition: 41 } })])],
      options(),
    );
    const advisory = outcomes.find((o) => o.kind === 'action' && o.action.actionType === 'rank_first');
    expect(advisory).toBeDefined();
    if (advisory?.kind === 'action') {
      expect(advisory.action.artifact).toBeNull();
      expect(advisory.action.rationale).toContain('position 41');
    }
  });

  it('does not generate a content action for a non-blocking gap', async () => {
    const notRanking = gap({
      gapType: 'not_ranking',
      blockedAtGate: 2,
      evidence: { organicPosition: 35 },
    });
    const outcomes = await generateActions([detection([notRanking, gap()])], options());
    expect(outcomes.some((o) => o.kind === 'action' && o.action.actionType === 'answer_block')).toBe(false);
  });

  it('sorts actions by priority, refusals last', async () => {
    const outcomes = await generateActions(
      [
        detection([gap()]),
        detection([
          gap({
            gapType: 'rival_corroborated',
            blockedAtGate: 4,
            evidence: { placementTargets: ['reddit.com', 'youtube.com'], reason: 'rival backed' },
          }),
        ]),
      ],
      options(),
    );

    const priorities = outcomes.map((o) => (o.kind === 'action' ? o.action.priority : -1));
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
});

describe('shingleContainment', () => {
  it('scores identical text as 1 and unrelated text as 0', () => {
    expect(shingleContainment('the quick brown fox jumps', 'the quick brown fox jumps')).toBe(1);
    expect(shingleContainment('the quick brown fox', 'entirely different words here')).toBe(0);
  });

  it('still scores 1 when full reuse is padded with filler', () => {
    // The case Jaccard misses: verbatim copy plus one extra sentence. That
    // padded copy is exactly what the duplicate check exists to catch.
    const rival = 'a barlow blade in 1095 carbon steel holds a working edge for two weeks';
    const padded = `${rival} and we also offer free shipping on every order over fifty dollars`;
    expect(shingleContainment(padded, rival)).toBe(1);
  });

  it('handles text shorter than the shingle size', () => {
    expect(shingleContainment('two words', 'two words')).toBe(1);
    expect(shingleContainment('', 'anything')).toBe(0);
  });
});
