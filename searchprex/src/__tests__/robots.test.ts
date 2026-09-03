import { describe, expect, it } from 'vitest';
import {
  blockedCrawlersFor,
  ENGINE_CRAWLERS,
  groupFor,
  isAllowed,
  parseRobots,
  pathMatches,
} from '../lib/robots.js';

describe('parseRobots', () => {
  it('groups consecutive user-agent lines into one rule block', () => {
    const robots = parseRobots(`
User-agent: GPTBot
User-agent: PerplexityBot
Disallow: /admin/

User-agent: *
Disallow: /
    `);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[0]!.userAgents).toEqual(['gptbot', 'perplexitybot']);
  });

  it('ignores comments and treats an empty Disallow as no rule', () => {
    const robots = parseRobots('User-agent: *\nDisallow:      # allow everything\n');
    expect(robots.groups[0]!.rules).toEqual([]);
    expect(isAllowed(robots, 'PerplexityBot', '/anything')).toBe(true);
  });
});

describe('groupFor', () => {
  it('prefers a named group over the wildcard', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: PerplexityBot\nAllow: /\n');
    expect(groupFor(robots, 'PerplexityBot')!.userAgents).toEqual(['perplexitybot']);
    // The whole point: a blanket block does not apply to an explicitly allowed bot.
    expect(isAllowed(robots, 'PerplexityBot', '/products/x')).toBe(true);
    expect(isAllowed(robots, 'SomeOtherBot', '/products/x')).toBe(false);
  });

  it('picks the longest matching agent token', () => {
    const robots = parseRobots(
      'User-agent: Perplexity\nDisallow: /\n\nUser-agent: PerplexityBot\nAllow: /\n',
    );
    expect(groupFor(robots, 'PerplexityBot')!.userAgents).toEqual(['perplexitybot']);
  });
});

describe('pathMatches', () => {
  it('handles wildcards and end anchors', () => {
    expect(pathMatches('/products/', '/products/knife')).toBe(true);
    expect(pathMatches('/*.pdf$', '/docs/a.pdf')).toBe(true);
    expect(pathMatches('/*.pdf$', '/docs/a.pdf?x=1')).toBe(false);
    expect(pathMatches('/admin', '/administrator')).toBe(true);
  });
});

describe('isAllowed', () => {
  it('lets a longer Allow re-open a path under a blanket Disallow', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /\nAllow: /products/\n');
    expect(isAllowed(robots, 'PerplexityBot', '/products/barlow')).toBe(true);
    expect(isAllowed(robots, 'PerplexityBot', '/checkout')).toBe(false);
  });

  it('lets Allow win on an equal-length tie', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
    expect(isAllowed(robots, 'AnyBot', '/a')).toBe(true);
  });

  it('allows everything when robots.txt has no applicable group', () => {
    expect(isAllowed(parseRobots('User-agent: Googlebot\nDisallow: /'), 'PerplexityBot', '/x')).toBe(true);
  });
});

describe('blockedCrawlersFor', () => {
  it('flags a blocked Perplexity crawler', () => {
    const robots = parseRobots('User-agent: PerplexityBot\nDisallow: /\n');
    const blocked = blockedCrawlersFor(robots, 'perplexity', '/products/x');
    expect(blocked.map((b) => b.userAgent)).toEqual(['PerplexityBot']);
  });

  it('does not flag GPTBot, which is training-only', () => {
    // Blocking GPTBot does not remove a site from ChatGPT search. Reporting it
    // as an AI-search gap sends the customer to reopen a legal decision for no
    // visibility gain.
    const robots = parseRobots('User-agent: GPTBot\nDisallow: /\n');
    expect(blockedCrawlersFor(robots, 'openai', '/products/x')).toEqual([]);
    expect(ENGINE_CRAWLERS['openai']!.optional).toContain('GPTBot');
  });

  it('flags OAI-SearchBot, which does gate ChatGPT search', () => {
    const robots = parseRobots('User-agent: OAI-SearchBot\nDisallow: /\n');
    expect(blockedCrawlersFor(robots, 'openai', '/x').map((b) => b.userAgent)).toEqual([
      'OAI-SearchBot',
    ]);
  });

  it('does not treat a Google-Extended block as an AI Overviews block', () => {
    // Google-Extended governs Gemini grounding and training. AI Overviews runs
    // off the ordinary Googlebot crawl and has no separate opt-out.
    const robots = parseRobots('User-agent: Google-Extended\nDisallow: /\n');
    expect(blockedCrawlersFor(robots, 'aio', '/x')).toEqual([]);
    expect(blockedCrawlersFor(robots, 'gemini', '/x').map((b) => b.userAgent)).toEqual([
      'Google-Extended',
    ]);
  });
});
