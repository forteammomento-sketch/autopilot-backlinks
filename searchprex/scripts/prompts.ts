/**
 * Generate a prompt universe for a project and print it for review.
 *
 *   OPENAI_API_KEY=sk-... npm run prompts
 *   OPENAI_API_KEY=sk-... MAX_PAGES=120 npm run prompts -- smkstore.com
 *
 * Nothing is written anywhere: the set is the biggest recurring cost in the
 * product, so it gets read by a person before it starts being measured weekly.
 */
import { crawlSite } from '../src/crawl/crawl.js';
import { mergeSeeds, seedsFromCrawl, seedsFromSearchConsole } from '../src/prompts/seeds.js';
import { GoogleTokenSource } from '../src/gsc/auth.js';
import { SearchConsoleClient } from '../src/gsc/client.js';
import { generatePrompts, weeklyCost } from '../src/prompts/generate.js';
import { OpenAIPromptWriter } from '../src/prompts/openai-writer.js';
import { MSO } from './projects.js';

const apiKey = process.env['OPENAI_API_KEY'];
if (apiKey === undefined || apiKey === '') {
  console.error('OPENAI_API_KEY is not set');
  process.exit(1);
}

const domain = process.argv[2] === undefined || process.argv[2] === '' ? MSO.origin : process.argv[2];
const maxPages = Number(process.env['MAX_PAGES'] ?? '60');
const maxTotal = Number(process.env['MAX_PROMPTS'] ?? '60');

const siteUrl = process.env['GSC_SITE_URL'];
const clientId = process.env['GOOGLE_CLIENT_ID'];
const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];

let gscSeeds: Awaited<ReturnType<typeof seedsFromSearchConsole>> = [];
if (siteUrl && clientId && clientSecret && refreshToken) {
  console.log(`reading Search Console for ${siteUrl}...`);
  const client = new SearchConsoleClient({
    siteUrl,
    tokens: new GoogleTokenSource({ clientId, clientSecret, refreshToken }),
  });
  const rows = await client.queries({ limit: 500 });
  gscSeeds = seedsFromSearchConsole(rows, 40, {
    brandAliases: MSO.context.brandNames,
    minImpressions: 5,
  });
  console.log(`${rows.length} queries, ${gscSeeds.length} usable as seeds`);
} else {
  console.log('Search Console is not configured — seeding from the catalogue only.');
  console.log('Set GSC_SITE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and');
  console.log('GOOGLE_REFRESH_TOKEN to seed from measured demand instead.\n');
}

console.log(`crawling ${domain} for seeds (max ${maxPages} pages)...`);
const index = await crawlSite(domain, { maxPages });

if (!index.reachable && gscSeeds.length === 0) {
  console.error(`could not reach ${domain} and Search Console gave no seeds.`);
  process.exit(2);
}

const seeds = mergeSeeds(gscSeeds, index.reachable ? seedsFromCrawl(index) : []);
console.log(`${seeds.length} seeds (${gscSeeds.length} from Search Console)\n`);

if (seeds.length === 0) {
  console.error('No product or category pages were found. Prompt generation needs real');
  console.error('inventory to work from — a set invented from the topic alone asks about');
  console.error('products the site does not stock.');
  process.exit(2);
}

const report = await generatePrompts(
  seeds,
  { topic: 'knives and outdoor gear', brandAliases: MSO.context.brandNames },
  new OpenAIPromptWriter({ apiKey }),
  { maxTotal },
);

const byCluster = new Map<string, typeof report.prompts>();
for (const prompt of report.prompts) {
  byCluster.set(prompt.cluster, [...(byCluster.get(prompt.cluster) ?? []), prompt]);
}

for (const [cluster, prompts] of byCluster) {
  console.log(`\n${cluster}`);
  for (const prompt of prompts) {
    console.log(`  ${prompt.intent.padEnd(14)} ${prompt.text}`);
  }
}

const counts = new Map<string, number>();
for (const r of report.rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);

console.log(`\n${report.prompts.length} kept, ${report.rejected.length} rejected`);
for (const [reason, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)} ${reason}`);
}

console.log(
  `\nWeekly cost of this set: ${String(report.weeklyCallsPerEngine)} calls per engine ` +
    `(${String(weeklyCost(report.prompts.length, 2))} across two engines).`,
);
