import { isSameSite, registrableDomain } from '../lib/domain.js';
import { visibleText, wordCount } from '../lib/html.js';
import {
  crawlDelayFor,
  ENGINE_CRAWLERS,
  isAllowed,
  parseRobots,
  type RobotsTxt,
} from '../lib/robots.js';
import {
  AI_CRAWLER_USER_AGENTS,
  DEFAULT_USER_AGENT,
  fetchUrl,
  pooled,
  sleep,
  type FetchOptions,
} from './fetcher.js';
import { canonicalOf, firstHeadingOf, internalLinks, titleOf } from './links.js';
import { parseSitemap } from './sitemap.js';

export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  title: string | null;
  heading: string | null;
  canonical: string | null;
  words: number;
  internalInboundLinks: number;
}

export interface CrawlerProbe {
  userAgent: string;
  status: number;
  /** True when the edge served a block to this crawler but not to us. */
  blocked: boolean;
}

export interface SiteIndex {
  domain: string;
  robotsTxt: string | null;
  robots: RobotsTxt | null;
  pages: CrawledPage[];
  /**
   * False when the crawl reached nothing at all — DNS failure, the site down,
   * egress blocked. Distinct from a site that answered and simply has no
   * relevant page: one is a gap, the other is a broken crawl, and reporting
   * the second as the first tells a customer to write content for a site we
   * never opened.
   */
  reachable: boolean;
  /** Edge-level access per AI crawler, when probing was enabled. */
  crawlerProbes: CrawlerProbe[];
  stats: {
    discovered: number;
    fetched: number;
    blockedByRobots: number;
    failed: number;
    source: 'sitemap' | 'links' | 'none';
  };
}

export interface CrawlOptions extends FetchOptions {
  /** Hard ceiling on pages fetched. Default 200. */
  maxPages?: number;
  /** Requests in flight. Default 4, and lowered further by any crawl-delay. */
  concurrency?: number;
  /** Floor for the gap between requests, in ms. Default 200. */
  minDelayMs?: number;
  /**
   * Send AI crawler user-agent strings to detect edge-level blocking that
   * robots.txt does not show. Only ever runs against `domain` itself, which
   * must be a site the customer owns. Default false.
   */
  probeAiCrawlers?: boolean;
}

/**
 * Crawl one site and return everything the gap detector needs.
 *
 * Discovery prefers sitemaps and falls back to following internal links from
 * the homepage. Pages robots.txt disallows for our own agent are counted but
 * never fetched: a tool that audits crawler access while ignoring robots.txt
 * itself has no standing to report the finding.
 */
export async function crawlSite(domain: string, options: CrawlOptions = {}): Promise<SiteIndex> {
  const {
    maxPages = 200,
    concurrency = 4,
    minDelayMs = 200,
    probeAiCrawlers = false,
    userAgent = DEFAULT_USER_AGENT,
  } = options;

  const origin = originOf(domain);
  const registrable = registrableDomain(origin) ?? domain;

  const robotsResult = await fetchUrl(`${origin}/robots.txt`, options);
  const robotsTxt =
    robotsResult.status === 200 && robotsResult.body.trim() !== '' ? robotsResult.body : null;
  const robots = robotsTxt === null ? null : parseRobots(robotsTxt);

  const delayMs = Math.max(minDelayMs, (robots === null ? 0 : crawlDelayFor(robots, userAgent) ?? 0) * 1_000);
  // A site asking for a crawl-delay is asking for one request at a time.
  const effectiveConcurrency = delayMs > minDelayMs ? 1 : concurrency;

  const discovery = await discoverUrls(origin, registrable, robots, maxPages, options);

  let blockedByRobots = 0;
  const fetchable = discovery.urls.filter((url) => {
    if (robots === null) return true;
    const allowed = isAllowed(robots, userAgent, pathOf(url));
    if (!allowed) blockedByRobots += 1;
    return allowed;
  });

  const results = await pooled(fetchable, effectiveConcurrency, async (url, index) => {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    return fetchUrl(url, options);
  });

  const pages: CrawledPage[] = [];
  let failed = 0;

  for (const result of results) {
    if (result.status !== 200 || result.body === '') {
      failed += 1;
      continue;
    }
    if (result.contentType !== null && !/text\/html/i.test(result.contentType)) continue;

    pages.push({
      url: result.url,
      finalUrl: result.finalUrl,
      status: result.status,
      html: result.body,
      title: titleOf(result.body),
      heading: firstHeadingOf(result.body),
      canonical: canonicalOf(result.body, result.finalUrl),
      words: wordCount(visibleText(result.body)),
      internalInboundLinks: 0,
    });
  }

  countInboundLinks(pages, registrable);

  const crawlerProbes = probeAiCrawlers ? await probeCrawlerAccess(`${origin}/`, options) : [];

  return {
    domain: registrable,
    robotsTxt,
    robots,
    pages,
    // Anything came back: a page, or a robots.txt, or a discovered URL list.
    // Zero of all three means we never reached the site.
    reachable: pages.length > 0 || robotsTxt !== null || discovery.source !== 'none',
    crawlerProbes,
    stats: {
      discovered: discovery.urls.length,
      fetched: pages.length,
      blockedByRobots,
      failed,
      source: discovery.source,
    },
  };
}

interface Discovery {
  urls: string[];
  source: SiteIndex['stats']['source'];
}

async function discoverUrls(
  origin: string,
  registrable: string,
  robots: RobotsTxt | null,
  maxPages: number,
  options: CrawlOptions,
): Promise<Discovery> {
  const seeds = [...(robots?.sitemaps ?? []), `${origin}/sitemap.xml`];
  const found = new Set<string>();
  const seenSitemaps = new Set<string>();
  const queue = [...new Set(seeds)];

  // One level of sitemap-index expansion. Deeper nesting exists but is rare,
  // and an unbounded walk over a large retailer's sitemap tree is exactly the
  // runaway this crawler is capped to avoid.
  while (queue.length > 0 && found.size < maxPages) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    const response = await fetchUrl(sitemapUrl, options);
    if (response.status !== 200 || response.body === '') continue;

    const parsed = parseSitemap(response.body);
    for (const url of parsed.urls) {
      if (!isSameSite(url, registrable)) continue;
      if (parsed.isIndex) {
        if (seenSitemaps.size + queue.length < 50) queue.push(url);
      } else if (found.size < maxPages) {
        found.add(url);
      }
    }
  }

  if (found.size > 0) return { urls: [...found].slice(0, maxPages), source: 'sitemap' };

  // No usable sitemap: follow internal links from the homepage, one level.
  // The trailing slash matters — `origin` has no path, and requesting it bare
  // both misses servers that only route `/` and produces a second key for the
  // homepage alongside the `https://host/` form every sitemap emits.
  const homeUrl = `${origin}/`;
  const home = await fetchUrl(homeUrl, options);
  if (home.status !== 200 || home.body === '') return { urls: [homeUrl], source: 'none' };

  const links = internalLinks(home.body, home.finalUrl, registrable);
  return {
    urls: [homeUrl, ...links].slice(0, maxPages),
    source: 'links',
  };
}

/**
 * Count how many crawled pages link to each page.
 *
 * Both the raw URL and the canonical are indexed, because a page reached at
 * `/p?variant=2` and canonicalised to `/p` is one page and its inbound links
 * belong together. Without that, well-linked product variants look orphaned.
 */
function countInboundLinks(pages: CrawledPage[], registrable: string): void {
  const index = new Map<string, CrawledPage>();
  for (const page of pages) {
    index.set(normalise(page.url), page);
    index.set(normalise(page.finalUrl), page);
    if (page.canonical !== null) index.set(normalise(page.canonical), page);
  }

  for (const page of pages) {
    const seen = new Set<CrawledPage>();
    for (const href of internalLinks(page.html, page.finalUrl, registrable)) {
      const target = index.get(normalise(href));
      // A page linking to itself is not an inbound link from elsewhere.
      if (target === undefined || target === page || seen.has(target)) continue;
      seen.add(target);
      target.internalInboundLinks += 1;
    }
  }
}

/**
 * Ask the site for its homepage as each AI crawler and record what comes back.
 *
 * The URL is built from `origin`, so this cannot be pointed at a third-party
 * host: impersonating another company's crawler is only defensible against a
 * site the customer owns and has asked us to audit.
 */
export async function probeCrawlerAccess(
  origin: string,
  options: CrawlOptions = {},
): Promise<CrawlerProbe[]> {
  const wanted = new Set<string>();
  for (const crawlers of Object.values(ENGINE_CRAWLERS)) {
    for (const bot of crawlers.required) wanted.add(bot);
  }

  const baseline = await fetchUrl(origin, options);
  const probes: CrawlerProbe[] = [];

  for (const bot of wanted) {
    const ua = AI_CRAWLER_USER_AGENTS[bot];
    if (ua === undefined) continue;

    const result = await fetchUrl(origin, { ...options, userAgent: ua });
    probes.push({
      userAgent: bot,
      status: result.status,
      // Only a block *relative to us* is a finding. A site that is down for
      // everyone is a different problem and must not be reported as AI-bot
      // blocking.
      blocked: baseline.status === 200 && (result.status === 403 || result.status === 429),
    });
    await sleep(options.minDelayMs ?? 200);
  }

  return probes;
}

function originOf(domain: string): string {
  const withScheme = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return `https://${domain}`;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return `${parsed.host.replace(/^www\./i, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url;
  }
}
