import { describe, expect, it } from 'vitest';
import { analyseResult, classifyCitationOwner, type ProjectContext } from '../lib/citations.js';
import type { EngineResult } from '../engines/types.js';

const context: ProjectContext = {
  domain: 'smkstore.com',
  brandNames: ['SMK Store'],
  competitors: [
    { domain: 'bladehq.com', brandNames: ['Blade HQ'] },
    { domain: 'knifecenter.com', brandNames: ['KnifeCenter'] },
  ],
};

function resultWith(answerText: string, urls: string[]): EngineResult {
  return {
    engine: 'perplexity',
    answered: true,
    answerText,
    citations: urls.map((url, i) => ({ position: i + 1, url })),
    servedBy: 'sonar',
    latencyMs: 10,
    raw: {},
  };
}

describe('classifyCitationOwner', () => {
  it('separates self, competitor and third party', () => {
    expect(classifyCitationOwner('https://www.smkstore.com/p', context)).toBe('self');
    expect(classifyCitationOwner('https://bladehq.com/x', context)).toBe('competitor');
    expect(classifyCitationOwner('https://reddit.com/r/knives', context)).toBe('third_party');
  });
});

describe('analyseResult', () => {
  it('records mentioned and cited independently', () => {
    // Named in prose but never linked — real, and not the same as being cited.
    const analysis = analyseResult(
      resultWith('SMK Store carries it, though Blade HQ has more stock.', [
        'https://bladehq.com/barlow',
      ]),
      context,
    );
    expect(analysis.brandMentioned).toBe(true);
    expect(analysis.brandCited).toBe(false);
    expect(analysis.citedAtPosition).toBeNull();
  });

  it('records a citation without a prose mention', () => {
    const analysis = analyseResult(
      resultWith('Several retailers stock this knife.', [
        'https://reddit.com/r/knives',
        'https://smkstore.com/products/barlow',
      ]),
      context,
    );
    expect(analysis.brandMentioned).toBe(false);
    expect(analysis.brandCited).toBe(true);
    expect(analysis.citedAtPosition).toBe(2);
  });

  it('collects the placement target list from third-party citations', () => {
    const analysis = analyseResult(
      resultWith('...', [
        'https://reddit.com/r/knives/abc',
        'https://bladehq.com/x',
        'https://www.reddit.com/r/knives/def',
        'https://youtube.com/watch?v=1',
      ]),
      context,
    );
    // Reddit appears twice under different hosts and collapses to one target.
    expect(analysis.thirdPartyDomains).toEqual(['reddit.com', 'youtube.com']);
    expect(analysis.competitorDomainsCited).toEqual(['bladehq.com']);
  });

  it('handles a result with no citations at all', () => {
    const analysis = analyseResult(resultWith('No idea.', []), context);
    expect(analysis.brandCited).toBe(false);
    expect(analysis.thirdPartyDomains).toEqual([]);
  });
});
