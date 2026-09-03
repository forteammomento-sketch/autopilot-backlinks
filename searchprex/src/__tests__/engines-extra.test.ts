import { describe, expect, it, vi } from 'vitest';
import { GeminiAdapter, resolveSourceUrl } from '../engines/gemini.js';
import { SerpApiAdapter } from '../engines/serp.js';
import { EngineError } from '../engines/errors.js';
import { analyseResult } from '../lib/citations.js';
import type { ProjectContext } from '../lib/citations.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123';

const GEMINI_BODY = {
  modelVersion: 'gemini-2.0-flash-001',
  candidates: [
    {
      content: {
        parts: [{ text: 'Blade HQ and Michigan Sports Outdoor both stock it.' }],
      },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: `${REDIRECT}xyz`, title: 'bladehq.com' } },
          { web: { uri: `${REDIRECT}abc`, title: 'michigansportsoutdoor.com' } },
        ],
      },
    },
  ],
};

describe('resolveSourceUrl', () => {
  it('prefers the title when the uri is a Google redirect', () => {
    // The redirect host is not the source. Using it would resolve every
    // citation to one Google domain: the customer's own pages would never
    // match, and the whole run would read as "nobody is ever cited".
    expect(resolveSourceUrl(REDIRECT, 'bladehq.com')).toBe('https://bladehq.com');
  });

  it('keeps a real uri untouched', () => {
    expect(resolveSourceUrl('https://bladehq.com/barlow', 'Blade HQ — Barlow')).toBe(
      'https://bladehq.com/barlow',
    );
  });

  it('keeps the redirect when the title is a page title, not a domain', () => {
    expect(resolveSourceUrl(REDIRECT, 'The 10 Best Barlow Knives')).toBe(REDIRECT);
  });

  it('returns null when there is nothing usable', () => {
    expect(resolveSourceUrl('', 'a page title with spaces')).toBeNull();
  });
});

describe('GeminiAdapter', () => {
  it('resolves grounding chunks to real domains', async () => {
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => jsonResponse(GEMINI_BODY)) as never,
    });
    const result = await adapter.query('best barlow knife');

    expect(result.citations.map((c) => c.url)).toEqual([
      'https://bladehq.com',
      'https://michigansportsoutdoor.com',
    ]);
    expect(result.servedBy).toBe('gemini-2.0-flash-001');
  });

  it('produces citations the analyser can actually attribute', async () => {
    // The end the redirect fix exists for: self and competitor both resolve.
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => jsonResponse(GEMINI_BODY)) as never,
    });
    const context: ProjectContext = {
      domain: 'michigansportsoutdoor.com',
      brandNames: ['Michigan Sports Outdoor'],
      competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
    };

    const analysis = analyseResult(await adapter.query('q'), context);
    expect(analysis.brandCited).toBe(true);
    expect(analysis.competitorDomainsCited).toEqual(['bladehq.com']);
  });

  it('sends the key in a header, never in the URL', async () => {
    // A credential in a query string lands in access logs and proxy traces.
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        jsonResponse(GEMINI_BODY),
    );
    await new GeminiAdapter({ apiKey: 'secret-key', fetchImpl: fetchImpl as never }).query('q');

    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('secret-key');
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('secret-key');
  });

  it('honours a legacy grounding tool name', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        jsonResponse(GEMINI_BODY),
    );
    await new GeminiAdapter({
      apiKey: 'k',
      toolName: 'google_search_retrieval',
      fetchImpl: fetchImpl as never,
    }).query('q');

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.tools).toEqual([{ google_search_retrieval: {} }]);
  });

  it('reports answered=false when a candidate is blocked', async () => {
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] })) as never,
    });
    expect((await adapter.query('q')).answered).toBe(false);
  });
});

describe('SerpApiAdapter — AI Overviews', () => {
  const adapter = (fetchImpl: typeof fetch): SerpApiAdapter =>
    new SerpApiAdapter({ apiKey: 'k', surface: 'aio', fetchImpl });

  it('reports answered=false when no AI Overview fired', async () => {
    // The common case, and the reason this adapter exists. Collapsing it into
    // "not cited" manufactures gaps for prompts where no answer box appeared
    // for anyone to be cited in.
    const result = await adapter(
      vi.fn(async () => jsonResponse({ organic_results: [{ link: 'https://bladehq.com' }] })) as never,
    ).query('best barlow knife');

    expect(result.answered).toBe(false);
    expect(result.answerText).toBe('');
    expect(result.citations).toEqual([]);
  });

  it('flattens nested text blocks and reads the references', async () => {
    const result = await adapter(
      vi.fn(async () =>
        jsonResponse({
          ai_overview: {
            text_blocks: [
              { type: 'paragraph', snippet: 'A barlow is a two-blade pattern.' },
              {
                type: 'list',
                list: [{ snippet: 'Rough Rider is the budget option.' }, { snippet: 'Case is pricier.' }],
              },
            ],
            references: [
              { title: 'Blade HQ', link: 'https://bladehq.com/barlow', source: 'bladehq.com' },
              { title: 'Blade HQ', link: 'https://bladehq.com/barlow' },
            ],
          },
        }),
      ) as never,
    ).query('q');

    expect(result.answered).toBe(true);
    expect(result.answerText).toContain('Rough Rider is the budget option.');
    expect(result.citations).toHaveLength(1);
  });

  it('treats a vendor error inside a 200 as a failure', async () => {
    const error = (await adapter(
      vi.fn(async () => jsonResponse({ error: 'Your account has run out of searches.' })) as never,
    )
      .query('q')
      .catch((e: unknown) => e)) as EngineError;

    expect(error).toBeInstanceOf(EngineError);
    expect(error.message).toContain('run out of searches');
  });
});

describe('SerpApiAdapter — Bing AI answers', () => {
  it('is labelled for what it measures, not for Copilot', async () => {
    // Copilot has no public API. This reads the Bing SERP answer surface, which
    // shares retrieval with Copilot but is not the same product.
    const adapter = new SerpApiAdapter({
      apiKey: 'k',
      surface: 'copilot',
      fetchImpl: vi.fn(async () => jsonResponse({})) as never,
    });
    expect(adapter.label).toBe('Bing AI answers');
    expect(adapter.key).toBe('copilot');
  });

  it('reads the answer box and its links', async () => {
    const result = await new SerpApiAdapter({
      apiKey: 'k',
      surface: 'copilot',
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          answer_box: {
            answer: 'A barlow blade in 1095 holds an edge for about two weeks.',
            links: [{ title: 'MSO', link: 'https://michigansportsoutdoor.com/p' }],
          },
        }),
      ) as never,
    }).query('q');

    expect(result.answered).toBe(true);
    expect(result.citations[0]!.url).toBe('https://michigansportsoutdoor.com/p');
  });

  it('queries the bing engine, not google', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => jsonResponse({}),
    );
    await new SerpApiAdapter({ apiKey: 'k', surface: 'copilot', fetchImpl: fetchImpl as never })
      .query('q', { locale: 'en-GB' });

    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain('engine=bing');
    expect(url).toContain('gl=gb');
  });
});
