import { describe, expect, it, vi } from 'vitest';
import { PerplexityAdapter } from '../engines/perplexity.js';
import { EngineError } from '../engines/errors.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function adapterWith(fetchImpl: typeof fetch): PerplexityAdapter {
  return new PerplexityAdapter({ apiKey: 'test-key', fetchImpl });
}

const SEARCH_RESULTS_BODY = {
  id: 'x',
  model: 'sonar',
  choices: [{ message: { role: 'assistant', content: 'The Rough Rider Barlow is a good pick.' } }],
  search_results: [
    { title: 'Best Barlow Knives', url: 'https://bladehq.com/best-barlow', date: '2026-08-01' },
    { title: 'SMK Store Barlow', url: 'https://www.smkstore.com/products/barlow' },
  ],
};

describe('PerplexityAdapter', () => {
  it('parses the current search_results shape', async () => {
    const adapter = adapterWith(vi.fn(async () => jsonResponse(SEARCH_RESULTS_BODY)) as never);
    const result = await adapter.query('best budget barlow knife');

    expect(result.engine).toBe('perplexity');
    expect(result.answered).toBe(true);
    expect(result.answerText).toContain('Rough Rider Barlow');
    expect(result.citations).toEqual([
      {
        position: 1,
        url: 'https://bladehq.com/best-barlow',
        title: 'Best Barlow Knives',
        date: '2026-08-01',
      },
      {
        position: 2,
        url: 'https://www.smkstore.com/products/barlow',
        title: 'SMK Store Barlow',
      },
    ]);
    expect(result.raw).toEqual(SEARCH_RESULTS_BODY);
  });

  it('falls back to the legacy citations array', async () => {
    const adapter = adapterWith(
      vi.fn(async () =>
        jsonResponse({
          model: 'sonar',
          choices: [{ message: { content: 'answer' } }],
          citations: ['https://a.com/1', 'https://b.com/2'],
        }),
      ) as never,
    );
    const result = await adapter.query('q');
    expect(result.citations.map((c) => c.url)).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('strips a reasoning block so it cannot count as a brand mention', async () => {
    const adapter = adapterWith(
      vi.fn(async () =>
        jsonResponse({
          model: 'sonar-reasoning',
          choices: [
            {
              message: {
                content:
                  '<think>Maybe SMK Store sells this, but I am not sure.</think>Blade HQ stocks it.',
              },
            },
          ],
        }),
      ) as never,
    );
    const result = await adapter.query('q');
    expect(result.answerText).toBe('Blade HQ stocks it.');
    expect(result.answerText).not.toContain('SMK Store');
  });

  it('sends no system message, temperature or domain filter', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => jsonResponse(SEARCH_RESULTS_BODY),
    );
    await adapterWith(fetchImpl as never).query('best barlow');

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'best barlow' }]);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('search_domain_filter');
  });

  it('maps a locale to a country for the search context', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => jsonResponse(SEARCH_RESULTS_BODY),
    );
    await adapterWith(fetchImpl as never).query('q', { locale: 'en-GB' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.web_search_options.user_location.country).toBe('GB');
  });

  it('classifies 429 as retryable and reads Retry-After', async () => {
    const adapter = adapterWith(
      vi.fn(async () =>
        new Response('slow down', { status: 429, headers: { 'Retry-After': '12' } }),
      ) as never,
    );
    const error = await adapter.query('q').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).kind).toBe('rate_limit');
    expect((error as EngineError).retryable).toBe(true);
    expect((error as EngineError).retryAfter).toBe(12);
  });

  it('classifies 401 as non-retryable auth', async () => {
    const adapter = adapterWith(
      vi.fn(async () => new Response('nope', { status: 401 })) as never,
    );
    const error = (await adapter.query('q').catch((e: unknown) => e)) as EngineError;
    expect(error.kind).toBe('auth');
    expect(error.retryable).toBe(false);
  });

  it('rejects an empty prompt without spending a call', async () => {
    const fetchImpl = vi.fn();
    const error = (await adapterWith(fetchImpl as never)
      .query('   ')
      .catch((e: unknown) => e)) as EngineError;
    expect(error.kind).toBe('bad_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to construct without a key', () => {
    expect(() => new PerplexityAdapter({ apiKey: '' })).toThrow(EngineError);
  });

  it('reports answered=false when the engine returns no content', async () => {
    const adapter = adapterWith(
      vi.fn(async () => jsonResponse({ model: 'sonar', choices: [] })) as never,
    );
    const result = await adapter.query('q');
    expect(result.answered).toBe(false);
    expect(result.citations).toEqual([]);
  });
});
