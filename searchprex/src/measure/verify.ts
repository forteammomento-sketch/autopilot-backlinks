import { markedIds } from '../deploy/markers.js';
import { hasSchemaType } from '../lib/html.js';
import { blockedCrawlersFor, parseRobots } from '../lib/robots.js';
import type { PendingRemeasure } from './types.js';

export interface LiveCheck {
  live: boolean;
  reason: string;
}

/**
 * Confirm a deploy actually reached the live site before measuring it.
 *
 * The deploy opens a **draft** pull request. Nobody may have merged it. A
 * follow-up run against an unchanged page records a loss for work that was
 * never shipped — a false negative that then drags down the win rate for that
 * whole action type, for every customer. Verification is what keeps the
 * evidence base honest, so a pending measurement that cannot be verified is
 * rescheduled rather than recorded.
 */
export function verifyAnswerBlockLive(html: string, blockId: string): LiveCheck {
  return markedIds(html).includes(blockId)
    ? { live: true, reason: 'block marker found on the page' }
    : { live: false, reason: 'the block is not on the live page — the pull request may be unmerged' };
}

export function verifySchemaLive(html: string, types: string[]): LiveCheck {
  return hasSchemaType(html, types)
    ? { live: true, reason: 'schema present' }
    : { live: false, reason: `no ${types.join('/')} markup on the live page` };
}

export function verifyCrawlFixLive(robotsTxt: string, engine: string, path: string): LiveCheck {
  const blocked = blockedCrawlersFor(parseRobots(robotsTxt), engine, path);
  return blocked.length === 0
    ? { live: true, reason: 'robots.txt now allows the crawlers this engine needs' }
    : {
        live: false,
        reason: `robots.txt still blocks ${blocked.map((b) => b.userAgent).join(', ')}`,
      };
}

export interface VerifySources {
  fetchPage: (url: string) => Promise<string | null>;
  fetchRobots?: () => Promise<string | null>;
}

export async function verifyDeployed(
  pending: PendingRemeasure,
  sources: VerifySources,
): Promise<LiveCheck> {
  // Nothing was deployed for a control prompt, so there is nothing to verify.
  if (pending.isControl === true) return { live: true, reason: 'control prompt' };

  if (pending.actionType === 'crawl_fix') {
    const robotsTxt = sources.fetchRobots === undefined ? null : await sources.fetchRobots();
    return robotsTxt === null
      ? { live: false, reason: 'could not fetch robots.txt' }
      : verifyCrawlFixLive(robotsTxt, pending.engine, pathOf(pending.targetUrl));
  }

  if (pending.targetUrl === null) {
    return { live: false, reason: 'no target URL to verify against' };
  }

  const html = await sources.fetchPage(pending.targetUrl);
  if (html === null) {
    return { live: false, reason: `could not fetch ${pending.targetUrl}` };
  }

  if (pending.actionType === 'answer_block') {
    return pending.blockId === undefined
      ? { live: false, reason: 'no block id recorded for this deploy' }
      : verifyAnswerBlockLive(html, pending.blockId);
  }

  if (pending.actionType === 'schema') {
    return verifySchemaLive(html, ['Product', 'FAQPage', 'Article', 'BlogPosting']);
  }

  // internal_link, placement and rank_first have no on-page signature we can
  // check, so they are measured on trust rather than blocked from measurement.
  return { live: true, reason: 'no on-page signature to verify for this action type' };
}

function pathOf(url: string | null): string {
  if (url === null) return '/';
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}
