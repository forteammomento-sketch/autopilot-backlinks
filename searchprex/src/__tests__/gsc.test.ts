import { describe, expect, it, vi } from 'vitest';
import { GoogleTokenSource, StaticTokenSource } from '../gsc/auth.js';
import { SearchConsoleClient, isoDaysAgo, isoDaysBefore } from '../gsc/client.js';
import { EngineError } from '../engines/errors.js';
import { opportunityScore, seedsFromSearchConsole } from '../prompts/seeds.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rowsResponse(count: number, offset = 0): Response {
  return jsonResponse({
    rows: Array.from({ length: count }, (_, i) => ({
      keys: [`query ${String(offset + i)}`],
      clicks: 1,
      impressions: 100 - offset - i,
      ctr: 0.01,
      position: 12,
    })),
  });
}

describe('GoogleTokenSource', () => {
  it('caches a token until it is nearly expired', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'tok', expires_in: 3600 }));
    const source = new GoogleTokenSource({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl: fetchImpl as never,
    });

    const now = Date.now();
    expect(await source.accessToken(now)).toBe('tok');
    expect(await source.accessToken(now + 60_000)).toBe('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Refreshes a minute early, so a token never expires mid-request.
    await source.accessToken(now + 3_600_000 - 30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never puts the secret in the error', async () => {
    // Google echoes a description that can quote the request. An exception
    // carrying a refresh token ends up in a log aggregator.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'refresh token refresh-abc' }, 400),
    );
    const source = new GoogleTokenSource({
      clientId: 'id',
      clientSecret: 'super-secret',
      refreshToken: 'refresh-abc',
      fetchImpl: fetchImpl as never,
    });

    const error = (await source.accessToken().catch((e: unknown) => e)) as EngineError;
    expect(error).toBeInstanceOf(EngineError);
    expect(JSON.stringify(error)).not.toContain('super-secret');
    expect(error.message).not.toContain('refresh-abc');
    expect(error.message).toContain('400');
  });

  it('refuses to construct with a missing credential', () => {
    expect(
      () => new GoogleTokenSource({ clientId: 'id', clientSecret: '', refreshToken: 'r' }),
    ).toThrow(EngineError);
  });
});

describe('SearchConsoleClient', () => {
  const tokens = new StaticTokenSource('tok');

  it('percent-encodes a domain property', async () => {
    // `sc-domain:example.com` has a colon; unencoded, the API reads the
    // property as a malformed URL and 404s.
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => rowsResponse(1),
    );
    await new SearchConsoleClient({
      siteUrl: 'sc-domain:michigansportsoutdoor.com',
      tokens,
      fetchImpl: fetchImpl as never,
    }).queries({ limit: 1 });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      'sc-domain%3Amichigansportsoutdoor.com',
    );
  });

  it('defaults the window to end three days ago', async () => {
    // Search Console lags two to three days. Asking for today returns nothing,
    // which reads as "this site has no queries".
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => rowsResponse(1),
    );
    await new SearchConsoleClient({
      siteUrl: 'https://mso.com/',
      tokens,
      fetchImpl: fetchImpl as never,
    }).queries({ limit: 1 });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.endDate).toBe(isoDaysAgo(3));
    expect(body.startDate).toBe(isoDaysBefore(body.endDate, 90));
    expect(body.dimensions).toEqual(['query']);
  });

  it('paginates until the limit', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => rowsResponse(2, (call++) * 2));
    const rows = await new SearchConsoleClient({
      siteUrl: 'https://mso.com/',
      tokens,
      fetchImpl: fetchImpl as never,
    }).queries({ limit: 5 });

    expect(rows).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('stops on a short page rather than re-requesting an empty tail', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => (call++ === 0 ? rowsResponse(2) : rowsResponse(0)));
    const rows = await new SearchConsoleClient({
      siteUrl: 'https://mso.com/',
      tokens,
      fetchImpl: fetchImpl as never,
    }).queries({ limit: 100 });

    expect(rows).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a rate limit and gives up on a 403', async () => {
    let call = 0;
    const limited = vi.fn(async () =>
      call++ === 0 ? new Response('slow', { status: 429 }) : rowsResponse(1),
    );
    const rows = await new SearchConsoleClient({
      siteUrl: 'https://mso.com/',
      tokens,
      fetchImpl: limited as never,
      sleep: async () => {},
    }).queries({ limit: 1 });
    expect(rows).toHaveLength(1);

    // A 403 means this credential cannot read the property. Retrying will not
    // change that.
    const denied = vi.fn(async () => new Response('nope', { status: 403 }));
    const error = (await new SearchConsoleClient({
      siteUrl: 'https://mso.com/',
      tokens,
      fetchImpl: denied as never,
      sleep: async () => {},
    })
      .queries({ limit: 1 })
      .catch((e: unknown) => e)) as EngineError;

    expect(error.kind).toBe('auth');
    expect(denied).toHaveBeenCalledTimes(1);
  });
});

describe('opportunityScore', () => {
  it('scores a query the engines will never retrieve at zero', () => {
    // Gate 2: nothing written can win a prompt whose page sits at position 50.
    expect(opportunityScore({ query: 'q', impressions: 5000, ctr: 0, position: 50 })).toBe(0);
  });

  it('discounts demand the site already converts', () => {
    const winning = opportunityScore({ query: 'q', impressions: 1000, ctr: 0.4, position: 2 });
    const stranded = opportunityScore({ query: 'q', impressions: 1000, ctr: 0.01, position: 12 });
    expect(stranded).toBeGreaterThan(winning);
  });

  it('ranks impressions the site is not converting highest', () => {
    const rows = [
      { query: 'converting well', impressions: 900, ctr: 0.35, position: 2 },
      { query: 'stranded impressions', impressions: 800, ctr: 0.005, position: 11 },
      { query: 'buried', impressions: 5000, ctr: 0, position: 44 },
    ];
    const seeds = seedsFromSearchConsole(rows);
    expect(seeds.map((s) => s.text)).toEqual(['stranded impressions', 'converting well']);
  });
});

describe('seedsFromSearchConsole', () => {
  it('drops branded queries, which are demand the site already owns', () => {
    const rows = [
      { query: 'michigan sports outdoor knives', impressions: 900, ctr: 0.3, position: 1 },
      { query: 'best barlow pocket knife', impressions: 400, ctr: 0.01, position: 9 },
    ];
    const seeds = seedsFromSearchConsole(rows, 40, {
      brandAliases: ['Michigan Sports Outdoor'],
    });
    expect(seeds.map((s) => s.text)).toEqual(['best barlow pocket knife']);
  });

  it('honours a minimum impression floor', () => {
    const rows = [
      { query: 'noise query', impressions: 1, ctr: 0, position: 10 },
      { query: 'real demand', impressions: 300, ctr: 0, position: 10 },
    ];
    expect(seedsFromSearchConsole(rows, 40, { minImpressions: 50 }).map((s) => s.text)).toEqual([
      'real demand',
    ]);
  });
});
