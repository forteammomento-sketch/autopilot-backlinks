/**
 * robots.txt parsing and matching, per RFC 9309.
 *
 * Gate 1 of the visibility model is binary: a crawler that cannot fetch the
 * page cannot cite it. This is the cheapest gap to detect and the cheapest to
 * fix, which is why it is checked before anything is generated.
 */

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  /** Seconds the site asks this agent to wait between requests. */
  crawlDelay?: number;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  /** Sitemap directives, which are file-scoped rather than group-scoped. */
  sitemaps: string[];
}

export function parseRobots(content: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one rule block; a rule line closes the
  // agent list, so the next User-agent starts a new group.
  let acceptingAgents = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    // Sitemap is not scoped to a group and may appear anywhere in the file.
    if (field === 'sitemap') {
      if (value !== '') sitemaps.push(value);
      continue;
    }

    if (field === 'user-agent') {
      if (current === null || !acceptingAgents) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        acceptingAgents = true;
      }
      if (value !== '') current.userAgents.push(value.toLowerCase());
      continue;
    }

    if (field === 'crawl-delay') {
      if (current === null) continue;
      acceptingAgents = false;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
      continue;
    }

    if (field !== 'allow' && field !== 'disallow') continue;
    if (current === null) continue;

    acceptingAgents = false;
    // `Disallow:` with an empty value means "allow everything" and carries no
    // rule of its own.
    if (field === 'disallow' && value === '') continue;
    current.rules.push({ allow: field === 'allow', path: value });
  }

  return { groups, sitemaps };
}

/** Crawl-delay that applies to `userAgent`, in seconds. */
export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | null {
  return groupFor(robots, userAgent)?.crawlDelay ?? null;
}

/**
 * Pick the group that applies to `userAgent`.
 *
 * Matching is on the product token, case-insensitively, longest match wins.
 * The `*` group is the fallback and is only used when no named group matches —
 * a site that disallows `*` but allows `PerplexityBot` is allowing Perplexity.
 */
export function groupFor(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const needle = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;

  for (const group of robots.groups) {
    for (const agent of group.userAgents) {
      if (agent === '*') continue;
      if (needle.includes(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }
  if (best !== null) return best;

  return robots.groups.find((g) => g.userAgents.includes('*')) ?? null;
}

/** Does a robots path pattern (with `*` and `$`) match this URL path? */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source = body
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether `userAgent` may fetch `path`.
 *
 * Most specific rule wins; on equal specificity Allow wins, which is what lets
 * `Allow: /products/` re-open a path under `Disallow: /`.
 */
export function isAllowed(robots: RobotsTxt, userAgent: string, path: string): boolean {
  const group = groupFor(robots, userAgent);
  if (group === null) return true;

  let verdict = true;
  let winningLength = -1;

  for (const rule of group.rules) {
    if (!pathMatches(rule.path, path)) continue;
    const length = rule.path.replace(/\$$/, '').length;
    if (length > winningLength || (length === winningLength && rule.allow)) {
      verdict = rule.allow;
      winningLength = length;
    }
  }

  return verdict;
}

/**
 * The crawlers each engine depends on.
 *
 * `required` bots gate retrieval — block one and the engine cannot cite you.
 * `optional` bots do something else (usually model training) and blocking them
 * costs no visibility.
 *
 * Two distinctions here are routinely got wrong, including by tools that sell
 * this check:
 *
 * - **GPTBot is training-only.** ChatGPT search retrieves with OAI-SearchBot
 *   and fetches live pages as ChatGPT-User. Blocking GPTBot does not remove a
 *   site from ChatGPT's answers, so flagging it as an AI-search problem sends
 *   the customer to argue with their legal team over nothing.
 * - **Google-Extended does not control AI Overviews.** It governs Gemini
 *   grounding and training. AI Overviews is served off the normal Googlebot
 *   crawl and cannot be opted out of separately at all — the only levers are
 *   `nosnippet`, `max-snippet` and `data-nosnippet`, which also cost you the
 *   ordinary search snippet.
 */
export const ENGINE_CRAWLERS: Record<
  string,
  { required: string[]; optional: string[] }
> = {
  perplexity: { required: ['PerplexityBot', 'Perplexity-User'], optional: [] },
  openai: { required: ['OAI-SearchBot', 'ChatGPT-User'], optional: ['GPTBot'] },
  gemini: { required: ['Googlebot', 'Google-Extended'], optional: [] },
  aio: { required: ['Googlebot'], optional: [] },
  copilot: { required: ['Bingbot'], optional: [] },
};

export interface BlockedCrawler {
  engine: string;
  userAgent: string;
  path: string;
}

/** Required crawlers for `engine` that robots.txt blocks from `path`. */
export function blockedCrawlersFor(
  robots: RobotsTxt,
  engine: string,
  path: string,
): BlockedCrawler[] {
  const crawlers = ENGINE_CRAWLERS[engine];
  if (crawlers === undefined) return [];

  return crawlers.required
    .filter((userAgent) => !isAllowed(robots, userAgent, path))
    .map((userAgent) => ({ engine, userAgent, path }));
}
