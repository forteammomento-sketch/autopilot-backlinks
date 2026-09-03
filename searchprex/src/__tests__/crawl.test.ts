import { describe, expect, it, vi } from 'vitest';
import { crawlSite, probeCrawlerAccess } from '../crawl/crawl.js';
import { buildSiteEvidence, inferSchemaTypes, rankCandidates } from '../crawl/evidence.js';
import { parseSitemap } from '../crawl/sitemap.js';
import { canonicalOf, internalLinks, titleOf } from '../crawl/links.js';
import { detectGaps } from '../gaps/detect.js';
import type { SampledPrompt } from '../runner/sample.js';
import type { ProjectContext } from '../lib/citations.js';

/** A tiny site served from a map of URL -> [status, contentType, body]. */
function fakeSite(routes: Record<string, [number, string, string]>) {
  const seenUserAgents: { url: string; ua: string }[] = [];
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seenUserAgents.push({ url, ua: headers['User-Agent'] ?? '' });

    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    const [status, contentType, body] = route;
    return new Response(body, { status, headers: { 'content-type': contentType } });
  });
  return { impl: impl as never as typeof fetch, seenUserAgents, calls: impl };
}

const HTML = 'text/html; charset=utf-8';

const PRODUCT_PAGE = `<html><head>
  <title>Rough Rider Barlow — how long the blade stays sharp | SMK</title>
  <link rel="canonical" href="https://smkstore.com/products/barlow">
  <script type="application/ld+json">{"@type":"Product","name":"Barlow"}</script>
</head><body>
  <h1>Rough Rider Barlow</h1>
  <p>A barlow knife blade in 1095 carbon steel stays sharp for roughly two weeks of
     daily cutting before it needs a strop, and about six weeks before a full sharpen.</p>
  <a href="/collections/knives">Knives</a>
</body></html>`;

const HOME = `<html><head><title>SMK Store</title></head><body>
  <a href="/products/barlow">Barlow</a>
  <a href="/collections/knives">Knives</a>
  <a href="https://facebook.com/smk">Facebook</a>
</body></html>`;

const COLLECTION = `<html><head><title>Knives</title></head><body>
  <a href="/products/barlow">Barlow</a>
  <a href="/products/barlow?variant=2">Barlow variant</a>
</body></html>`;

describe('parseSitemap', () => {
  it('reads a urlset with lastmod', () => {
    const parsed = parseSitemap(`<urlset>
      <url><loc>https://a.com/1</loc><lastmod>2026-08-01</lastmod></url>
      <url><loc>https://a.com/2</loc></url>
    </urlset>`);
    expect(parsed.isIndex).toBe(false);
    expect(parsed.urls).toEqual(['https://a.com/1', 'https://a.com/2']);
    expect(parsed.lastmod.get('https://a.com/1')).toBe('2026-08-01');
  });

  it('recognises a sitemap index', () => {
    const parsed = parseSitemap(
      '<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>',
    );
    expect(parsed.isIndex).toBe(true);
    expect(parsed.urls).toEqual(['https://a.com/s1.xml']);
  });

  it('decodes escaped ampersands in URLs', () => {
    const parsed = parseSitemap('<urlset><url><loc>https://a.com/p?a=1&amp;b=2</loc></url></urlset>');
    expect(parsed.urls).toEqual(['https://a.com/p?a=1&b=2']);
  });
});

describe('internalLinks', () => {
  it('keeps same-site links and drops external and non-http ones', () => {
    const links = internalLinks(HOME, 'https://smkstore.com/', 'smkstore.com');
    expect(links).toEqual([
      'https://smkstore.com/products/barlow',
      'https://smkstore.com/collections/knives',
    ]);
  });

  it('strips fragments so an anchor is not a separate page', () => {
    const links = internalLinks(
      '<a href="/p#reviews">a</a><a href="/p#specs">b</a>',
      'https://smkstore.com/',
      'smkstore.com',
    );
    expect(links).toEqual(['https://smkstore.com/p']);
  });

  it('ignores mailto, tel and javascript hrefs', () => {
    const links = internalLinks(
      '<a href="mailto:a@b.com">m</a><a href="tel:123">t</a><a href="javascript:void(0)">j</a>',
      'https://smkstore.com/',
      'smkstore.com',
    );
    expect(links).toEqual([]);
  });
});

describe('crawlSite', () => {
  const routes: Record<string, [number, string, string]> = {
    'https://smkstore.com/robots.txt': [
      200,
      'text/plain',
      'User-agent: *\nDisallow: /checkout\nSitemap: https://smkstore.com/sitemap.xml\n',
    ],
    'https://smkstore.com/sitemap.xml': [
      200,
      'application/xml',
      `<urlset>
         <url><loc>https://smkstore.com/</loc></url>
         <url><loc>https://smkstore.com/products/barlow</loc></url>
         <url><loc>https://smkstore.com/collections/knives</loc></url>
         <url><loc>https://smkstore.com/checkout</loc></url>
       </urlset>`,
    ],
    'https://smkstore.com/': [200, HTML, HOME],
    'https://smkstore.com/products/barlow': [200, HTML, PRODUCT_PAGE],
    'https://smkstore.com/collections/knives': [200, HTML, COLLECTION],
  };

  it('discovers pages from the sitemap named in robots.txt', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    expect(index.stats.source).toBe('sitemap');
    expect(index.pages.map((p) => p.url).sort()).toEqual([
      'https://smkstore.com/',
      'https://smkstore.com/collections/knives',
      'https://smkstore.com/products/barlow',
    ]);
  });

  it('obeys robots.txt for its own crawler', async () => {
    // A tool that audits crawler access while ignoring robots.txt itself has no
    // standing to report the finding.
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    expect(index.stats.blockedByRobots).toBe(1);
    expect(site.seenUserAgents.some((c) => c.url.includes('/checkout'))).toBe(false);
  });

  it('counts inbound internal links and ignores self-links', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    const barlow = index.pages.find((p) => p.url.endsWith('/products/barlow'))!;
    // Linked from the homepage and once from the collection: the collection's
    // second link is the same page under a variant query, canonicalised away.
    expect(barlow.internalInboundLinks).toBe(2);

    const collection = index.pages.find((p) => p.url.endsWith('/collections/knives'))!;
    expect(collection.internalInboundLinks).toBe(2);
  });

  it('falls back to following homepage links when no sitemap exists', async () => {
    const site = fakeSite({
      'https://smkstore.com/robots.txt': [404, 'text/plain', ''],
      'https://smkstore.com/': [200, HTML, HOME],
      'https://smkstore.com/products/barlow': [200, HTML, PRODUCT_PAGE],
      'https://smkstore.com/collections/knives': [200, HTML, COLLECTION],
    });
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    expect(index.stats.source).toBe('links');
    expect(index.pages.length).toBe(3);
  });

  it('respects maxPages', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', {
      fetchImpl: site.impl,
      minDelayMs: 0,
      maxPages: 2,
    });
    expect(index.pages.length).toBeLessThanOrEqual(2);
  });

  it('sends its own user-agent by default and never an AI crawler string', async () => {
    const site = fakeSite(routes);
    await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    expect(site.seenUserAgents.every((c) => c.ua.startsWith('SearchprexBot/'))).toBe(true);
  });
});

describe('an unreachable site', () => {
  it('is not reported as a content gap', async () => {
    // Regression: a crawl where every request fails used to fall through to
    // `no_page`, telling the customer to write content for a site we never
    // opened. A broken crawl is not evidence about the site.
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const index = await crawlSite('smkstore.com', {
      fetchImpl: impl as never,
      minDelayMs: 0,
    });

    expect(index.reachable).toBe(false);

    const evidence = await buildSiteEvidence(index, 'anything at all');
    expect(evidence.siteUnreachable).toBe(true);

    const context: ProjectContext = { domain: 'smkstore.com', brandNames: [], competitors: [] };
    const sampled: SampledPrompt = {
      engine: 'perplexity',
      prompt: 'anything at all',
      attempts: [],
      succeeded: 3,
      citedCount: 0,
      mentionedCount: 0,
      verdict: 'absent',
      thirdPartyDomains: [],
      competitorDomainsCited: [],
    };
    expect(detectGaps(sampled, context, evidence).gaps).toEqual([]);
  });

  it('stays reachable when the site answers but has nothing relevant', async () => {
    const site = fakeSite({
      'https://smkstore.com/robots.txt': [200, 'text/plain', 'User-agent: *\nAllow: /\n'],
      'https://smkstore.com/': [200, HTML, HOME],
    });
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    expect(index.reachable).toBe(true);
    const evidence = await buildSiteEvidence(index, 'best waterproof hiking boots for wide feet');
    expect(evidence.siteUnreachable).toBeUndefined();
    expect(evidence.candidatePage).toBeNull();
  });
});

describe('probeCrawlerAccess', () => {
  it('reports a crawler the edge blocks but robots.txt allows', async () => {
    // The Cloudflare-default case: permissive robots.txt, 403 at the edge.
    const site = fakeSite({});
    const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const ua = ((init?.headers ?? {}) as Record<string, string>)['User-Agent'] ?? '';
      if (/OAI-SearchBot/i.test(ua)) return new Response('blocked', { status: 403 });
      return new Response(HOME, { status: 200, headers: { 'content-type': HTML } });
    });
    void site;

    const probes = await probeCrawlerAccess('https://smkstore.com/', {
      fetchImpl: impl as never,
      minDelayMs: 0,
    });

    const blocked = probes.filter((p) => p.blocked).map((p) => p.userAgent);
    expect(blocked).toEqual(['OAI-SearchBot']);
  });

  it('does not call a site-wide outage an AI-bot block', async () => {
    const impl = vi.fn(async () => new Response('down', { status: 503 }));
    const probes = await probeCrawlerAccess('https://smkstore.com/', {
      fetchImpl: impl as never,
      minDelayMs: 0,
    });
    expect(probes.every((p) => !p.blocked)).toBe(true);
  });

  it('only ever requests the origin it was given', async () => {
    const requested: string[] = [];
    const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      requested.push(String(input));
      return new Response(HOME, { status: 200, headers: { 'content-type': HTML } });
    });
    await probeCrawlerAccess('https://smkstore.com/', { fetchImpl: impl as never, minDelayMs: 0 });

    expect(requested.every((u) => u.startsWith('https://smkstore.com'))).toBe(true);
  });
});

describe('buildSiteEvidence', () => {
  const routes: Record<string, [number, string, string]> = {
    'https://smkstore.com/robots.txt': [200, 'text/plain', 'User-agent: *\nAllow: /\n'],
    'https://smkstore.com/sitemap.xml': [
      200,
      'application/xml',
      `<urlset>
         <url><loc>https://smkstore.com/</loc></url>
         <url><loc>https://smkstore.com/products/barlow</loc></url>
       </urlset>`,
    ],
    'https://smkstore.com/': [200, HTML, HOME],
    'https://smkstore.com/products/barlow': [200, HTML, PRODUCT_PAGE],
  };

  const PROMPT = 'how long does a barlow knife blade stay sharp';

  it('picks the page that is actually about the prompt', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });
    const ranked = rankCandidates(index, PROMPT);

    expect(ranked[0]!.page.url).toBe('https://smkstore.com/products/barlow');

    const evidence = await buildSiteEvidence(index, PROMPT);
    expect(evidence.candidatePage!.url).toBe('https://smkstore.com/products/barlow');
    expect(evidence.candidatePage!.expectedSchemaTypes).toEqual(['Product']);
  });

  it('returns no candidate rather than the least-bad match', async () => {
    // Handing the generator a loosely related page is how an unrelated FAQ
    // ends up bolted onto a product page.
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    const evidence = await buildSiteEvidence(index, 'best waterproof hiking boots for wide feet');
    expect(evidence.candidatePage).toBeNull();
  });

  it('leaves renderedWords unset when the renderer fails', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    const evidence = await buildSiteEvidence(index, PROMPT, {
      renderHtml: async () => {
        throw new Error('browser crashed');
      },
    });
    // A missing signal, not evidence the page is fine.
    expect(evidence.candidatePage!.renderedWords).toBeUndefined();
  });

  it('finds a candidate that only exists after JavaScript runs', async () => {
    // Without this, a JavaScript-rendered site reports `no_page` for every
    // prompt — "you have no page about this" — and the gap type that exists
    // for exactly this case can never fire.
    const jsOnly = `<html><head><title>Rough Rider Barlow</title></head>
      <body><main><div id="root"></div></main></body></html>`;
    const rendered = `<html><head><title>Rough Rider Barlow</title></head>
      <body><main><h1>Rough Rider Barlow</h1>
      <p>A barlow knife blade in 1095 carbon steel stays sharp for roughly two weeks of
         daily cutting before it needs a strop, and about six weeks before a full sharpen.</p>
      </main></body></html>`;

    const site = fakeSite({
      'https://smkstore.com/robots.txt': [200, 'text/plain', 'User-agent: *\nAllow: /\n'],
      'https://smkstore.com/sitemap.xml': [
        200,
        'application/xml',
        '<urlset><url><loc>https://smkstore.com/products/barlow</loc></url></urlset>',
      ],
      'https://smkstore.com/products/barlow': [200, HTML, jsOnly],
    });
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    const withoutRenderer = await buildSiteEvidence(index, PROMPT);
    expect(withoutRenderer.candidatePage).toBeNull();

    const withRenderer = await buildSiteEvidence(index, PROMPT, {
      renderHtml: async () => rendered,
    });
    expect(withRenderer.candidatePage!.url).toBe('https://smkstore.com/products/barlow');
    // The raw markup is kept: that is the side the detector compares against.
    expect(withRenderer.candidatePage!.html).toContain('id="root"');
    expect(withRenderer.candidatePage!.renderedWords).toBeGreaterThan(30);
  });

  it('scores a realistic product title that does not restate the question', async () => {
    // A catalogue title is the product name, never the buyer's question. The
    // scoring has to clear the floor on term coverage across the page, or every
    // real product page is rejected as `no_page`.
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });
    const ranked = rankCandidates(index, PROMPT);
    expect(ranked[0]!.score).toBeGreaterThan(0.3);
  });

  it('counts rendered words with the same function as the raw side', async () => {
    // Raw and rendered have to be measured the same way or the js_only
    // threshold compares two different things.
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });

    const evidence = await buildSiteEvidence(index, PROMPT, {
      renderHtml: async () => '<html><body><main><p>one two three four five</p></main></body></html>',
    });
    expect(evidence.candidatePage!.renderedWords).toBe(5);
  });

  it('feeds a clean crawl into the detector with no gate-1 gaps', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });
    const evidence = await buildSiteEvidence(index, PROMPT);

    const context: ProjectContext = {
      domain: 'smkstore.com',
      brandNames: ['SMK Store'],
      competitors: [{ domain: 'bladehq.com', brandNames: ['Blade HQ'] }],
    };
    const sampled: SampledPrompt = {
      engine: 'perplexity',
      prompt: PROMPT,
      attempts: [],
      succeeded: 3,
      citedCount: 0,
      mentionedCount: 0,
      verdict: 'absent',
      thirdPartyDomains: [],
      competitorDomainsCited: [],
    };

    const result = detectGaps(sampled, context, evidence);
    expect(result.gaps.some((g) => g.blockedAtGate === 1)).toBe(false);
    expect(result.gaps.some((g) => g.gapType === 'weak_passage')).toBe(false);
    expect(result.gaps.some((g) => g.gapType === 'no_schema')).toBe(false);

    // The fixture site is two pages, so the product page has one inbound link
    // and is correctly reported as orphaned. Worth asserting rather than
    // fixture-ing away: it is what a real thin catalogue looks like.
    const orphan = result.gaps.find((g) => g.gapType === 'orphan')!;
    expect(orphan.evidence['internalInboundLinks']).toBe(1);
  });

  it('surfaces an edge block as a gate-1 gap', async () => {
    const site = fakeSite(routes);
    const index = await crawlSite('smkstore.com', { fetchImpl: site.impl, minDelayMs: 0 });
    const evidence = await buildSiteEvidence({
      ...index,
      crawlerProbes: [{ userAgent: 'PerplexityBot', status: 403, blocked: true }],
    }, PROMPT);

    const context: ProjectContext = { domain: 'smkstore.com', brandNames: [], competitors: [] };
    const sampled: SampledPrompt = {
      engine: 'perplexity',
      prompt: PROMPT,
      attempts: [],
      succeeded: 3,
      citedCount: 0,
      mentionedCount: 0,
      verdict: 'absent',
      thirdPartyDomains: [],
      competitorDomainsCited: [],
    };

    const gap = detectGaps(sampled, context, evidence).gaps.find((g) => g.gapType === 'bot_blocked')!;
    expect(gap.evidence['layer']).toBe('edge');
    expect(gap.evidence['userAgents']).toEqual(['PerplexityBot']);
  });
});

describe('helpers', () => {
  it('infers schema types from the URL shape', () => {
    expect(inferSchemaTypes('https://a.com/products/x')).toEqual(['Product']);
    expect(inferSchemaTypes('https://a.com/blog/x')).toEqual(['FAQPage', 'Article', 'BlogPosting']);
  });

  it('resolves a relative canonical', () => {
    expect(canonicalOf('<link rel="canonical" href="/p">', 'https://a.com/p?v=2')).toBe(
      'https://a.com/p',
    );
  });

  it('reads the title', () => {
    expect(titleOf('<title> Hello </title>')).toBe('Hello');
  });
});
