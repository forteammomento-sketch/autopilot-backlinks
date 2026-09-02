/**
 * Live smoke test against a real engine.
 *
 * Every other test in this package uses a stubbed fetch, which proves the
 * parsing but not that the request shape is one the provider accepts. Run this
 * after any change to an adapter's request body:
 *
 *   PERPLEXITY_API_KEY=pplx-... npm run smoke
 *   ENGINE=openai OPENAI_API_KEY=sk-... npm run smoke
 *
 * It spends 3 API calls per run.
 */
import { PerplexityAdapter } from '../src/engines/perplexity.js';
import { OpenAIAdapter } from '../src/engines/openai.js';
import { samplePrompt } from '../src/runner/sample.js';
import type { EngineAdapter } from '../src/engines/types.js';
import type { ProjectContext } from '../src/lib/citations.js';

const engine = process.env['ENGINE'] ?? 'perplexity';
const keyName = engine === 'openai' ? 'OPENAI_API_KEY' : 'PERPLEXITY_API_KEY';
const apiKey = process.env[keyName];
if (apiKey === undefined || apiKey === '') {
  console.error(`${keyName} is not set`);
  process.exit(1);
}

const context: ProjectContext = {
  domain: 'michigansportsoutdoor.com',
  brandNames: ['Michigan Sports Outdoor', 'MSO'],
  competitors: [
    { domain: 'bladehq.com', brandNames: ['Blade HQ'] },
    { domain: 'knifecenter.com', brandNames: ['KnifeCenter'] },
    { domain: 'smkw.com', brandNames: ['Smoky Mountain Knife Works'] },
  ],
};

const prompt = process.argv[2] ?? 'best budget barlow pocket knife under $40';

const model = process.env['MODEL'];
const adapter: EngineAdapter =
  engine === 'openai'
    ? new OpenAIAdapter({
        apiKey,
        ...(model === undefined ? {} : { model }),
        ...(process.env['OPENAI_TOOL_TYPE'] === undefined
          ? {}
          : { toolType: process.env['OPENAI_TOOL_TYPE'] }),
      })
    : new PerplexityAdapter({ apiKey, ...(model === undefined ? {} : { model }) });

const sampled = await samplePrompt(adapter, prompt, context, { locale: 'en-US' });

console.log(`\nprompt:   ${sampled.prompt}`);
console.log(`engine:   ${sampled.engine}`);
console.log(`verdict:  ${sampled.verdict}  (cited ${sampled.citedCount}/${sampled.succeeded})`);
console.log(`mentioned: ${sampled.mentionedCount}/${sampled.succeeded}`);
console.log(`\ncompetitors cited: ${sampled.competitorDomainsCited.join(', ') || '(none)'}`);
console.log(`placement targets: ${sampled.thirdPartyDomains.join(', ') || '(none)'}`);

for (const attempt of sampled.attempts) {
  if (attempt.error !== undefined) {
    console.log(`\n[${attempt.attempt}] FAILED ${attempt.error.kind}: ${attempt.error.message}`);
    continue;
  }
  const analysis = attempt.analysis!;
  console.log(`\n[${attempt.attempt}] ${attempt.result!.latencyMs}ms · ${analysis.citations.length} citations`);
  for (const c of analysis.citations) {
    console.log(`    ${String(c.position).padStart(2)} ${c.owner.padEnd(12)} ${c.domain ?? c.url}`);
  }
}
