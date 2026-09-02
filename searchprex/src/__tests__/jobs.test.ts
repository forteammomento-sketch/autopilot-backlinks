import { describe, expect, it, vi } from 'vitest';
import { CallBudget } from '../jobs/budget.js';
import { estimateCalls, runMeasurement } from '../jobs/measure.js';
import type { EngineAdapter, EngineResult } from '../engines/types.js';
import type { ProjectContext } from '../lib/citations.js';
import type { JobPrompt } from '../jobs/types.js';

const context: ProjectContext = {
  domain: 'michigansportsoutdoor.com',
  brandNames: ['Michigan Sports Outdoor'],
  competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
};

function adapter(key: string, urls: string[] = []): EngineAdapter {
  const result: EngineResult = {
    engine: key as EngineResult['engine'],
    answered: true,
    answerText: 'answer',
    citations: urls.map((url, i) => ({ position: i + 1, url })),
    servedBy: 'test',
    latencyMs: 1,
    raw: {},
  };
  return { key: key as EngineAdapter['key'], label: key, query: vi.fn(async () => result) };
}

const prompts: JobPrompt[] = [
  { id: 'p1', text: 'best budget barlow pocket knife under $40' },
  { id: 'p2', text: 'how long does a 1095 carbon steel blade stay sharp' },
  { id: 'p3', text: 'best fixed blade hunting knife for whitetail deer' },
];

const deps = { context, sleep: async () => {} };

describe('CallBudget', () => {
  it('refuses a reservation that would cross the ceiling', () => {
    const budget = new CallBudget(5);
    expect(budget.take(3)).toBe(true);
    expect(budget.take(3)).toBe(false);
    expect(budget.spent).toBe(3);
    expect(budget.remaining).toBe(2);
  });

  it('rejects a nonsense limit', () => {
    expect(() => new CallBudget(-1)).toThrow(RangeError);
  });
});

describe('estimateCalls', () => {
  it('is the number the caller checks before spending anything', () => {
    expect(estimateCalls(60, 5, 3)).toBe(900);
  });
});

describe('runMeasurement', () => {
  it('measures every prompt on every engine', async () => {
    const adapters = { perplexity: adapter('perplexity'), openai: adapter('openai') };
    const run = await runMeasurement(prompts, new CallBudget(100), { ...deps, adapters });

    expect(run.status).toBe('completed');
    expect(run.results).toHaveLength(6);
    expect(run.callsSpent).toBe(18);
    expect(run.skipped).toEqual([]);
  });

  it('reserves the whole repeat set, never leaving a one-attempt sample', async () => {
    // A budget that allows four calls can pay for one 3-repeat sample, not two.
    // Measuring a prompt once and stopping would record something that reads
    // like a verdict but is a sample of size one.
    const adapters = { perplexity: adapter('perplexity') };
    const run = await runMeasurement(prompts, new CallBudget(4), { ...deps, adapters });

    expect(run.status).toBe('budget_exhausted');
    expect(run.results).toHaveLength(1);
    expect(run.results[0]!.attempts).toHaveLength(3);
    expect(run.callsSpent).toBe(3);
  });

  it('finishes a prompt across all engines before starting the next', async () => {
    // Stopping mid-run should leave prompts fully measured, not every prompt
    // measured on one engine — the second cannot be compared against anything.
    const adapters = { perplexity: adapter('perplexity'), openai: adapter('openai') };
    const run = await runMeasurement(prompts, new CallBudget(6), { ...deps, adapters });

    expect(run.results.map((r) => `${r.promptId}:${r.engine}`)).toEqual([
      'p1:perplexity',
      'p1:openai',
    ]);
  });

  it('owes a skipped row for everything it did not reach', async () => {
    const adapters = { perplexity: adapter('perplexity'), openai: adapter('openai') };
    const run = await runMeasurement(prompts, new CallBudget(6), { ...deps, adapters });

    expect(run.results).toHaveLength(2);
    expect(run.skipped).toHaveLength(4);
    expect(run.results.length + run.skipped.length).toBe(prompts.length * 2);
  });

  it('persists each result as it lands', async () => {
    // A run that dies at prompt 40 of 60 should keep the first 39.
    const seen: string[] = [];
    const adapters = { perplexity: adapter('perplexity') };
    await runMeasurement(prompts, new CallBudget(100), {
      ...deps,
      adapters,
      onResult: async (r) => {
        seen.push(r.promptId);
      },
    });
    expect(seen).toEqual(['p1', 'p2', 'p3']);
  });

  it('stops on cancellation without spending more', async () => {
    const controller = new AbortController();
    const adapters = { perplexity: adapter('perplexity') };
    const budget = new CallBudget(100);

    const onResult = async (): Promise<void> => {
      controller.abort();
    };
    const run = await runMeasurement(prompts, budget, {
      ...deps,
      adapters,
      onResult,
      signal: controller.signal,
    });

    expect(run.status).toBe('cancelled');
    expect(run.results).toHaveLength(1);
    expect(budget.spent).toBe(3);
  });

  it('records a verdict of unknown rather than a loss when an engine is down', async () => {
    const failing: EngineAdapter = {
      key: 'openai',
      label: 'openai',
      query: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const run = await runMeasurement([prompts[0]!], new CallBudget(100), {
      ...deps,
      adapters: { openai: failing },
    });

    expect(run.status).toBe('completed');
    expect(run.results[0]!.verdict).toBe('unknown');
  });
});
