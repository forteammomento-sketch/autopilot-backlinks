import { describe, expect, it, vi } from 'vitest';
import { samplePrompt, queryWithRetry } from '../runner/sample.js';
import { EngineError } from '../engines/errors.js';
import type { EngineAdapter, EngineResult } from '../engines/types.js';
import type { ProjectContext } from '../lib/citations.js';

const context: ProjectContext = {
  domain: 'smkstore.com',
  brandNames: ['SMK Store'],
  competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
};

function result(urls: string[]): EngineResult {
  return {
    engine: 'perplexity',
    answered: true,
    answerText: 'answer',
    citations: urls.map((url, i) => ({ position: i + 1, url })),
    servedBy: 'sonar',
    latencyMs: 1,
    raw: {},
  };
}

function adapterReturning(...results: (EngineResult | Error)[]): EngineAdapter {
  let i = 0;
  return {
    key: 'perplexity',
    label: 'Perplexity',
    query: vi.fn(async () => {
      const next = results[Math.min(i, results.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return next!;
    }),
  };
}

const noSleep = async () => {};

describe('queryWithRetry', () => {
  it('retries a retryable error and then succeeds', async () => {
    const adapter = adapterReturning(
      new EngineError('rate_limit', 'perplexity', '429'),
      result(['https://smkstore.com/p']),
    );
    const out = await queryWithRetry(adapter, 'q', { sleep: noSleep });
    expect(out.citations).toHaveLength(1);
    expect(adapter.query).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error', async () => {
    const adapter = adapterReturning(new EngineError('auth', 'perplexity', '401'));
    await expect(queryWithRetry(adapter, 'q', { sleep: noSleep })).rejects.toThrow(EngineError);
    expect(adapter.query).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries', async () => {
    const adapter = adapterReturning(new EngineError('server', 'perplexity', '500'));
    await expect(
      queryWithRetry(adapter, 'q', { sleep: noSleep, maxRetries: 2 }),
    ).rejects.toThrow(EngineError);
    expect(adapter.query).toHaveBeenCalledTimes(3);
  });
});

describe('samplePrompt', () => {
  it('reports "cited" only when every attempt cited the brand', async () => {
    const adapter = adapterReturning(result(['https://smkstore.com/p']));
    const sampled = await samplePrompt(adapter, 'q', context, { sleep: noSleep });
    expect(sampled.verdict).toBe('cited');
    expect(sampled.citedCount).toBe(3);
    expect(sampled.succeeded).toBe(3);
  });

  it('reports "contested" when the engine is inconsistent', async () => {
    // The state a single-run tool would report as a clean win or a clean loss.
    const adapter = adapterReturning(
      result(['https://smkstore.com/p']),
      result(['https://bladehq.com/p']),
      result(['https://bladehq.com/p']),
    );
    const sampled = await samplePrompt(adapter, 'q', context, { sleep: noSleep });
    expect(sampled.verdict).toBe('contested');
    expect(sampled.citedCount).toBe(1);
  });

  it('reports "absent" when no attempt cited the brand', async () => {
    const adapter = adapterReturning(result(['https://bladehq.com/p']));
    const sampled = await samplePrompt(adapter, 'q', context, { sleep: noSleep });
    expect(sampled.verdict).toBe('absent');
    expect(sampled.competitorDomainsCited).toEqual(['bladehq.com']);
  });

  it('reports "unknown" rather than "absent" when every call failed', async () => {
    // Conflating an outage with a real absence would generate work for a gap
    // that was never observed.
    const adapter = adapterReturning(new EngineError('auth', 'perplexity', '401'));
    const sampled = await samplePrompt(adapter, 'q', context, { sleep: noSleep });
    expect(sampled.verdict).toBe('unknown');
    expect(sampled.succeeded).toBe(0);
    expect(sampled.attempts.every((a) => a.error !== undefined)).toBe(true);
  });

  it('unions third-party domains across attempts', async () => {
    const adapter = adapterReturning(
      result(['https://reddit.com/a']),
      result(['https://youtube.com/b']),
      result(['https://reddit.com/c']),
    );
    const sampled = await samplePrompt(adapter, 'q', context, { sleep: noSleep });
    expect(sampled.thirdPartyDomains).toEqual(['reddit.com', 'youtube.com']);
  });
});
