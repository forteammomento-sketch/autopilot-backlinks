import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../engines/openai.js';
import { EngineError } from '../engines/errors.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function adapterWith(fetchImpl: typeof fetch): OpenAIAdapter {
  return new OpenAIAdapter({ apiKey: 'test-key', fetchImpl });
}

const RESPONSE_BODY = {
  id: 'resp_1',
  model: 'gpt-4o-2024-11-20',
  status: 'completed',
  output: [
    { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'Blade HQ and SMK Store both stock it.',
          annotations: [
            { type: 'url_citation', url: 'https://bladehq.com/barlow', title: 'Blade HQ' },
            { type: 'url_citation', url: 'https://smkstore.com/p/barlow', title: 'SMK Store' },
          ],
        },
      ],
    },
  ],
};

describe('OpenAIAdapter', () => {
  it('extracts answer text and skips web_search_call items', async () => {
    const result = await adapterWith(
      vi.fn(async () => jsonResponse(RESPONSE_BODY)) as never,
    ).query('best barlow');

    expect(result.engine).toBe('openai');
    expect(result.answerText).toBe('Blade HQ and SMK Store both stock it.');
    expect(result.servedBy).toBe('gpt-4o-2024-11-20');
    expect(result.citations).toHaveLength(2);
  });

  it('deduplicates the same URL cited across several spans', async () => {
    // Annotations are per-span, so one page backing three sentences arrives
    // three times. Counting those as three citations would inflate every
    // downstream number.
    const result = await adapterWith(
      vi.fn(async () =>
        jsonResponse({
          model: 'gpt-4o',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'One. Two. Three.',
                  annotations: [
                    { type: 'url_citation', url: 'https://a.com/x', title: 'A' },
                    { type: 'url_citation', url: 'https://a.com/x', title: 'A' },
                    { type: 'url_citation', url: 'https://b.com/y', title: 'B' },
                    { type: 'url_citation', url: 'https://a.com/x', title: 'A' },
                  ],
                },
              ],
            },
          ],
        }),
      ) as never,
    ).query('q');

    expect(result.citations).toEqual([
      { position: 1, url: 'https://a.com/x', title: 'A' },
      { position: 2, url: 'https://b.com/y', title: 'B' },
    ]);
  });

  it('ignores annotation types that are not url_citation', async () => {
    const result = await adapterWith(
      vi.fn(async () =>
        jsonResponse({
          model: 'gpt-4o',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'text',
                  annotations: [
                    { type: 'file_citation', file_id: 'f1' },
                    { type: 'url_citation', url: 'https://a.com/x' },
                  ],
                },
              ],
            },
          ],
        }),
      ) as never,
    ).query('q');

    expect(result.citations.map((c) => c.url)).toEqual(['https://a.com/x']);
  });

  it('sends the web search tool and no system message', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        jsonResponse(RESPONSE_BODY),
    );
    await adapterWith(fetchImpl as never).query('best barlow', { locale: 'en-GB' });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.input).toBe('best barlow');
    expect(body.tools[0].type).toBe('web_search');
    expect(body.tools[0].user_location.country).toBe('GB');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('instructions');
  });

  it('honours a configured legacy tool name', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        jsonResponse(RESPONSE_BODY),
    );
    await new OpenAIAdapter({
      apiKey: 'k',
      toolType: 'web_search_preview',
      fetchImpl: fetchImpl as never,
    }).query('q');

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.tools[0].type).toBe('web_search_preview');
  });

  it('treats a 200 carrying status=failed as a retryable server error', async () => {
    const error = (await adapterWith(
      vi.fn(async () =>
        jsonResponse({ status: 'failed', error: { message: 'upstream exploded' } }),
      ) as never,
    )
      .query('q')
      .catch((e: unknown) => e)) as EngineError;

    expect(error.kind).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('upstream exploded');
  });

  it('keeps partial text from an incomplete response', async () => {
    const result = await adapterWith(
      vi.fn(async () =>
        jsonResponse({
          status: 'incomplete',
          model: 'gpt-4o',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'partial answer' }] },
          ],
        }),
      ) as never,
    ).query('q');

    expect(result.answered).toBe(true);
    expect(result.answerText).toBe('partial answer');
  });

  it('classifies 429 as retryable', async () => {
    const error = (await adapterWith(
      vi.fn(async () => new Response('slow', { status: 429, headers: { 'Retry-After': '5' } })) as never,
    )
      .query('q')
      .catch((e: unknown) => e)) as EngineError;

    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfter).toBe(5);
  });

  it('refuses to construct without a key', () => {
    expect(() => new OpenAIAdapter({ apiKey: '  ' })).toThrow(EngineError);
  });
});
