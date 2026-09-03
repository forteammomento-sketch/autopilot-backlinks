import { describe, expect, it, vi } from 'vitest';
import { cohortLift, directionOf, isConfident, toLiftRecord } from '../measure/lift.js';
import { winRates, winRateDetail, MIN_SAMPLE } from '../measure/winrate.js';
import { verifyAnswerBlockLive, verifyCrawlFixLive, verifySchemaLive } from '../measure/verify.js';
import { dueAt, isDue, runRemeasure, toRetry } from '../measure/remeasure.js';
import { applyAnswerBlock } from '../deploy/apply.js';
import { blockId } from '../deploy/markers.js';
import { priorityFor } from '../actions/rank.js';
import type { LiftRecord, PendingRemeasure } from '../measure/types.js';
import type { EngineAdapter, EngineResult } from '../engines/types.js';
import type { ProjectContext } from '../lib/citations.js';
import type { AnswerBlockArtifact } from '../actions/types.js';

const context: ProjectContext = {
  domain: 'michigansportsoutdoor.com',
  brandNames: ['Michigan Sports Outdoor'],
  competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
};

function pending(overrides: Partial<PendingRemeasure> = {}): PendingRemeasure {
  return {
    actionId: 'a1',
    actionType: 'answer_block',
    prompt: 'how long does a barlow knife blade stay sharp',
    engine: 'perplexity',
    targetUrl: 'https://michigansportsoutdoor.com/products/barlow',
    blockId: 'deadbeef',
    deployedAt: '2026-09-01T00:00:00.000Z',
    baseline: { cited: 0, total: 3 },
    ...overrides,
  };
}

function adapterCiting(urls: string[]): EngineAdapter {
  const result: EngineResult = {
    engine: 'perplexity',
    answered: true,
    answerText: 'answer',
    citations: urls.map((url, i) => ({ position: i + 1, url })),
    servedBy: 'sonar',
    latencyMs: 1,
    raw: {},
  };
  return { key: 'perplexity', label: 'Perplexity', query: vi.fn(async () => result) };
}

describe('lift direction and confidence', () => {
  it('labels a complete flip as gained and confident', () => {
    const before = { cited: 0, total: 3 };
    const after = { cited: 3, total: 3 };
    expect(directionOf(before, after)).toBe('gained');
    expect(isConfident(before, after)).toBe(true);
  });

  it('refuses to call a partial move confident', () => {
    // 0/3 to 2/3 has a Fisher exact p around 0.4 — indistinguishable from the
    // engine answering differently on the day. Calling it confident would be
    // the most misleading number this product could print.
    const before = { cited: 0, total: 3 };
    const after = { cited: 2, total: 3 };
    expect(directionOf(before, after)).toBe('improved');
    expect(isConfident(before, after)).toBe(false);
  });

  it('marks a complete loss', () => {
    expect(directionOf({ cited: 3, total: 3 }, { cited: 0, total: 3 })).toBe('lost');
    expect(isConfident({ cited: 3, total: 3 }, { cited: 0, total: 3 })).toBe(true);
  });

  it('is never confident when a side has no successful attempts', () => {
    expect(isConfident({ cited: 0, total: 0 }, { cited: 3, total: 3 })).toBe(false);
  });
});

describe('cohortLift', () => {
  function record(over: Partial<LiftRecord>): LiftRecord {
    return {
      actionId: 'x',
      actionType: 'answer_block',
      prompt: 'p',
      engine: 'perplexity',
      baseline: { cited: 0, total: 3 },
      followup: { cited: 3, total: 3 },
      direction: 'gained',
      confident: true,
      isControl: false,
      measuredAt: '2026-09-15T00:00:00.000Z',
      ...over,
    };
  }

  it('subtracts the control drift from the treated movement', () => {
    // Both groups rose. Only the difference is attributable to the work — the
    // rest is the engine reindexing, which the untouched prompts also rode.
    const records = [
      record({ followup: { cited: 3, total: 3 } }),
      record({ followup: { cited: 3, total: 3 } }),
      record({ isControl: true, followup: { cited: 2, total: 3 } }),
      record({ isControl: true, followup: { cited: 2, total: 3 } }),
    ];

    const lift = cohortLift(records);
    expect(lift.treatedDelta).toBeCloseTo(1);
    expect(lift.controlDelta).toBeCloseTo(2 / 3);
    expect(lift.netLift).toBeCloseTo(1 / 3);
    expect(lift.hasControl).toBe(true);
  });

  it('reports a drift that swallows the whole gain', () => {
    const records = [
      record({ followup: { cited: 2, total: 3 } }),
      record({ isControl: true, followup: { cited: 2, total: 3 } }),
    ];
    expect(cohortLift(records).netLift).toBeCloseTo(0);
  });

  it('flags the absence of a control group', () => {
    const lift = cohortLift([record({})]);
    expect(lift.hasControl).toBe(false);
    expect(lift.netLift).toBeCloseTo(1);
  });
});

describe('winRates', () => {
  function records(count: number, wins: number): LiftRecord[] {
    return Array.from({ length: count }, (_, i) => ({
      actionId: `a${String(i)}`,
      actionType: 'answer_block' as const,
      prompt: 'p',
      engine: 'perplexity',
      baseline: { cited: 0, total: 3 },
      followup: { cited: i < wins ? 3 : 0, total: 3 },
      direction: (i < wins ? 'gained' : 'unchanged') as LiftRecord['direction'],
      confident: i < wins,
      isControl: false,
      measuredAt: '2026-09-15T00:00:00.000Z',
    }));
  }

  it('reports nothing below the minimum sample', () => {
    // Three lucky deploys would otherwise push an action type to the top of
    // every customer's queue on evidence indistinguishable from chance.
    expect(winRates(records(3, 3))).toEqual({});
  });

  it('reports a rate once the sample is large enough', () => {
    expect(winRates(records(MIN_SAMPLE, 15))['answer_block']).toBeCloseTo(0.75);
  });

  it('composes with the ranker default of 0.5 when unmeasured', () => {
    const rates = winRates(records(3, 3));
    const withoutData = priorityFor({ actionType: 'answer_block', certainty: 'proven' });
    const fromRates = priorityFor({
      actionType: 'answer_block',
      certainty: 'proven',
      ...(rates['answer_block'] === undefined
        ? {}
        : { historicalWinRate: rates['answer_block'] }),
    });
    expect(fromRates).toBe(withoutData);
  });

  it('excludes control records, which had nothing deployed', () => {
    const mixed = [...records(MIN_SAMPLE, 20), ...records(5, 0).map((r) => ({ ...r, isControl: true }))];
    expect(winRates(mixed)['answer_block']).toBe(1);
    expect(winRateDetail(mixed)[0]!.sample).toBe(MIN_SAMPLE);
  });
});

describe('verification', () => {
  const artifact: AnswerBlockArtifact = {
    kind: 'answer_block',
    question: 'How long does a barlow blade stay sharp?',
    answer: 'a',
    supporting: [],
    factsUsed: [],
    html: '<section class="sp-answer">x</section>',
  };

  it('finds a block that actually shipped', () => {
    const page = applyAnswerBlock('<body><main></main></body>', artifact).content;
    expect(verifyAnswerBlockLive(page, blockId(artifact.question)).live).toBe(true);
  });

  it('reports an unmerged deploy rather than assuming it shipped', () => {
    // Measuring an unmerged pull request records a loss for work never
    // shipped, which then drags down the win rate for the whole action type.
    const check = verifyAnswerBlockLive('<body><main></main></body>', 'deadbeef');
    expect(check.live).toBe(false);
    expect(check.reason).toContain('unmerged');
  });

  it('checks schema and robots fixes too', () => {
    expect(verifySchemaLive('<script type="application/ld+json">{"@type":"Product"}</script>', ['Product']).live).toBe(true);
    expect(verifyCrawlFixLive('User-agent: *\nAllow: /\n', 'perplexity', '/p').live).toBe(true);
    expect(verifyCrawlFixLive('User-agent: PerplexityBot\nDisallow: /\n', 'perplexity', '/p').live).toBe(false);
  });
});

describe('runRemeasure', () => {
  const livePage = applyAnswerBlock('<body><main></main></body>', {
    kind: 'answer_block',
    question: 'q',
    answer: 'a',
    supporting: [],
    factsUsed: [],
    html: '<section>x</section>',
  }).content;
  const liveBlockId = blockId('q');

  const deps = (over: Partial<Parameters<typeof runRemeasure>[1]> = {}) => ({
    adapters: { perplexity: adapterCiting(['https://michigansportsoutdoor.com/products/barlow']) },
    context,
    fetchPage: async () => livePage,
    now: () => new Date('2026-09-20T00:00:00.000Z'),
    sampleOptions: { sleep: async () => {} },
    ...over,
  });

  it('waits until the change has had time to be indexed', async () => {
    const outcomes = await runRemeasure(
      [pending({ blockId: liveBlockId })],
      deps({ now: () => new Date('2026-09-05T00:00:00.000Z') }),
    );
    expect(outcomes[0]!.kind).toBe('not_due');
    if (outcomes[0]!.kind === 'not_due') {
      expect(outcomes[0]!.dueAt).toBe(dueAt(pending()).toISOString());
    }
  });

  it('measures a live, due deploy', async () => {
    const outcomes = await runRemeasure([pending({ blockId: liveBlockId })], deps());
    expect(outcomes[0]!.kind).toBe('measured');
    if (outcomes[0]!.kind === 'measured') {
      expect(outcomes[0]!.record.followup).toEqual({ cited: 3, total: 3 });
      expect(outcomes[0]!.record.direction).toBe('gained');
      expect(outcomes[0]!.record.confident).toBe(true);
    }
  });

  it('does not record a loss for an unmerged pull request', async () => {
    const outcomes = await runRemeasure(
      [pending({ blockId: 'notthere' })],
      deps({ fetchPage: async () => '<body><main></main></body>' }),
    );
    expect(outcomes[0]!.kind).toBe('not_live');
    expect(toRetry(outcomes)).toHaveLength(1);
  });

  it('does not record a loss for an engine outage', async () => {
    const failing: EngineAdapter = {
      key: 'perplexity',
      label: 'Perplexity',
      query: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const outcomes = await runRemeasure(
      [pending({ blockId: liveBlockId })],
      deps({ adapters: { perplexity: failing } }),
    );
    expect(outcomes[0]!.kind).toBe('failed');
    if (outcomes[0]!.kind === 'failed') expect(outcomes[0]!.reason).toContain('outage');
  });

  it('measures a control prompt without verifying anything', async () => {
    const fetchPage = vi.fn(async () => '<body></body>');
    const outcomes = await runRemeasure(
      [pending({ isControl: true, actionType: 'answer_block' })],
      deps({ fetchPage }),
    );
    expect(outcomes[0]!.kind).toBe('measured');
    expect(fetchPage).not.toHaveBeenCalled();
    if (outcomes[0]!.kind === 'measured') expect(outcomes[0]!.record.isControl).toBe(true);
  });

  it('fails a row whose engine has no adapter', async () => {
    const outcomes = await runRemeasure([pending({ engine: 'gemini' })], deps());
    expect(outcomes[0]!.kind).toBe('failed');
  });

  it('returns everything unmeasured for retry', async () => {
    const outcomes = await runRemeasure(
      [pending({ blockId: liveBlockId }), pending({ actionId: 'a2', deployedAt: '2026-09-19T00:00:00.000Z' })],
      deps(),
    );
    expect(outcomes.filter((o) => o.kind === 'measured')).toHaveLength(1);
    expect(toRetry(outcomes)).toHaveLength(1);
  });
});

describe('isDue', () => {
  it('waits the full window', () => {
    expect(isDue(pending(), new Date('2026-09-14T23:00:00.000Z'))).toBe(false);
    expect(isDue(pending(), new Date('2026-09-15T00:00:00.000Z'))).toBe(true);
  });
});

describe('toLiftRecord', () => {
  it('carries the baseline through unchanged', () => {
    const record = toLiftRecord(pending(), { cited: 1, total: 3 }, '2026-09-20T00:00:00.000Z');
    expect(record.baseline).toEqual({ cited: 0, total: 3 });
    expect(record.direction).toBe('improved');
    expect(record.confident).toBe(false);
  });
});
