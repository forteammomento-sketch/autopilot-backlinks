/**
 * Crawl a real site and print what the gap detector would see.
 *
 *   npm run crawl -- "" "how long does a pocket knife blade stay sharp"
 *   npm run crawl -- smkstore.com "how long does a barlow knife blade stay sharp"
 *   PROBE=1 npm run crawl -- "" "..."     # also probe edge blocking
 *
 * The domain defaults to the MSO storefront in scripts/projects.ts.
 *
 * No engine calls and no API key: this exercises discovery, robots handling,
 * inbound-link counting and candidate selection on its own.
 */
import { crawlSite } from '../src/crawl/crawl.js';
import { buildSiteEvidence, rankCandidates } from '../src/crawl/evidence.js';
import { detectGaps } from '../src/gaps/detect.js';
import type { SampledPrompt } from '../src/runner/sample.js';
import { MSO } from './projects.js';

const domain = process.argv[2] === undefined || process.argv[2] === '' ? MSO.origin : process.argv[2];
const prompt = process.argv[3];

if (prompt === undefined) {
  console.error('usage: npm run crawl -- [domain] "<prompt>"');
  console.error(`       domain defaults to ${MSO.origin}`);
  process.exit(1);
}

const maxPages = Number(process.env['MAX_PAGES'] ?? '60');

console.log(`crawling ${domain} (max ${maxPages} pages)...`);
const index = await crawlSite(domain, {
  maxPages,
  probeAiCrawlers: process.env['PROBE'] === '1',
});

if (!index.reachable) {
  console.error(`\ncould not reach ${domain} — nothing was fetched, not even robots.txt.`);
  console.error('No gaps are reported: a failed crawl is not evidence about the site.');
  process.exit(2);
}

console.log(`\ndiscovery: ${index.stats.source}`);
console.log(`discovered ${index.stats.discovered} · fetched ${index.stats.fetched} · ` +
            `blocked by robots ${index.stats.blockedByRobots} · failed ${index.stats.failed}`);

if (index.crawlerProbes.length > 0) {
  console.log('\ncrawler access:');
  for (const probe of index.crawlerProbes) {
    console.log(`  ${probe.userAgent.padEnd(18)} ${probe.status} ${probe.blocked ? 'BLOCKED' : 'ok'}`);
  }
}

console.log('\ntop candidates for the prompt:');
for (const { page, score } of rankCandidates(index, prompt).slice(0, 5)) {
  console.log(`  ${score.toFixed(2)}  ${String(page.internalInboundLinks).padStart(3)} links  ${page.url}`);
}

const evidence = await buildSiteEvidence(index, prompt);
console.log(`\ncandidate: ${evidence.candidatePage?.url ?? '(none — would report no_page)'}`);

// Assume the brand was not cited, which is what the detector is for.
const sampled: SampledPrompt = {
  engine: 'perplexity',
  prompt,
  attempts: [],
  succeeded: 3,
  citedCount: 0,
  mentionedCount: 0,
  verdict: 'absent',
  thirdPartyDomains: [],
  competitorDomainsCited: [],
};

const { gaps, blocking } = detectGaps(sampled, MSO.context, evidence);

console.log(`\ngaps (${gaps.length}), blocking = ${blocking?.gapType ?? 'none'}:`);
for (const gap of gaps) {
  console.log(`  gate ${gap.blockedAtGate}  ${gap.gapType.padEnd(20)} ${gap.certainty.padEnd(9)} ${String(gap.evidence['reason'])}`);
}
