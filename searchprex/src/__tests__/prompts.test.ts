import { describe, expect, it, vi } from 'vitest';
import { classifyIntent, namesBrand } from '../prompts/intent.js';
import { PromptDeduper, canonicalKey } from '../prompts/dedupe.js';
import { mergeSeeds, seedsFromCrawl, seedsFromSearchConsole } from '../prompts/seeds.js';
import { generatePrompts, weeklyCost } from '../prompts/generate.js';
import type { PromptSeed, PromptWriter } from '../prompts/types.js';
import type { SiteIndex } from '../crawl/crawl.js';
import { OpenAIPromptWriter } from '../prompts/openai-writer.js';
import { TemplatePromptWriter } from '../prompts/template-writer.js';
import { EngineError } from '../engines/errors.js';

const BRAND = ['Michigan Sports Outdoor', 'MSO'];

describe('classifyIntent', () => {
  it('reads the markers that decide what a win is worth', () => {
    expect(classifyIntent('best budget barlow pocket knife under $40')).toBe('commercial');
    expect(classifyIntent('rough rider vs case pocket knives')).toBe('comparison');
    expect(classifyIntent('how long does a 1095 blade stay sharp')).toBe('informational');
    expect(classifyIntent('is Michigan Sports Outdoor legit', BRAND)).toBe('brand');
  });

  it('lets comparison win over commercial', () => {
    // "best X vs Y" is a comparison the buyer is running, and worth more than a
    // generic listicle query.
    expect(classifyIntent('best barlow vs best sodbuster for whittling')).toBe('comparison');
  });

  it('does not match a brand inside a longer word', () => {
    expect(namesBrand('MSOX knives are different', ['MSO'])).toBe(false);
    expect(namesBrand('bought from MSO last year', ['MSO'])).toBe(true);
  });
});

describe('PromptDeduper', () => {
  it('treats a reworded question as the same measurement', () => {
    // Both get measured on every engine three times a week forever. A duplicate
    // is a standing charge for information already held.
    const d = new PromptDeduper();
    expect(d.add('best budget barlow knife under $40')).toBe(true);
    expect(d.add('cheapest barlow knife under 40 dollars')).toBe(false);
  });

  it('is order-independent', () => {
    expect(canonicalKey('best barlow knife')).toBe(canonicalKey('barlow knife best'));
  });

  it('keeps genuinely different prompts', () => {
    const d = new PromptDeduper();
    expect(d.add('best budget barlow knife under $40')).toBe(true);
    expect(d.add('how long does a 1095 carbon steel blade stay sharp')).toBe(true);
    expect(d.size).toBe(2);
  });

  it('seeds from an existing set so a re-run adds rather than repeats', () => {
    const d = new PromptDeduper(['best budget barlow knife under $40']);
    expect(d.add('best budget barlow knife under $40')).toBe(false);
  });
});

describe('seeds', () => {
  const index = {
    pages: [
      { finalUrl: 'https://mso.com/products/rough-rider-barlow', heading: 'Rough Rider Barlow', title: null },
      { finalUrl: 'https://mso.com/collections/hunting-knives', heading: null, title: 'Hunting Knives | MSO' },
      { finalUrl: 'https://mso.com/pages/about-us', heading: 'About Us', title: null },
    ],
  } as unknown as SiteIndex;

  it('takes catalogue pages and skips the ones nobody asks about before buying', () => {
    const seeds = seedsFromCrawl(index);
    expect(seeds.map((s) => s.text)).toEqual(['Rough Rider Barlow', 'Hunting Knives']);
    expect(seeds[0]!.cluster).toBe('rough rider barlow');
  });

  it('strips the site name retailers append to every title', () => {
    expect(seedsFromCrawl(index)[1]!.text).toBe('Hunting Knives');
  });

  it('ranks Search Console queries by measured demand', () => {
    const seeds = seedsFromSearchConsole([
      { query: 'barlow knife', impressions: 12 },
      { query: 'hunting knife michigan', impressions: 340 },
      { query: 'zero impressions', impressions: 0 },
    ]);
    expect(seeds.map((s) => s.text)).toEqual(['hunting knife michigan', 'barlow knife']);
  });

  it('puts measured demand ahead of inferred demand and deduplicates', () => {
    const gsc = seedsFromSearchConsole([{ query: 'rough rider barlow', impressions: 90 }]);
    const crawl = seedsFromCrawl(index);
    const merged = mergeSeeds(gsc, crawl);
    expect(merged[0]!.text).toBe('rough rider barlow');
    expect(merged.filter((s) => s.text.toLowerCase() === 'rough rider barlow')).toHaveLength(1);
  });
});

function writerOf(...batches: string[][]): PromptWriter {
  let i = 0;
  return { write: vi.fn(async () => batches[Math.min(i++, batches.length - 1)] ?? []) };
}

const seeds: PromptSeed[] = [
  { text: 'Rough Rider Barlow', cluster: 'pocket knives' },
  { text: 'Hunting Knives', cluster: 'hunting knives' },
];

const context = { topic: 'knives and outdoor gear', brandAliases: BRAND };

describe('generatePrompts', () => {
  it('rejects a prompt that names the brand', async () => {
    // A prompt naming the store is one the store nearly always wins, so it
    // measures brand recall rather than discovery.
    const writer = writerOf([
      'best budget barlow pocket knife under $40',
      'is Michigan Sports Outdoor a good place to buy knives',
    ]);
    const report = await generatePrompts([seeds[0]!], context, writer, { perSeed: 2 });

    expect(report.prompts.map((p) => p.text)).toEqual(['best budget barlow pocket knife under $40']);
    expect(report.rejected[0]!.reason).toBe('names_the_brand');
  });

  it('keeps brand prompts when they are asked for', async () => {
    const writer = writerOf(['is Michigan Sports Outdoor a good place to buy knives']);
    const report = await generatePrompts(
      [seeds[0]!],
      { ...context, allowBrandPrompts: true },
      writer,
      { perSeed: 1 },
    );
    expect(report.prompts[0]!.intent).toBe('brand');
  });

  it('rejects a keyword dressed up as a prompt', async () => {
    const writer = writerOf(['barlow knife', 'rough rider barlow jigged bone pocket knife']);
    const report = await generatePrompts([seeds[0]!], context, writer, { perSeed: 2 });

    expect(report.prompts).toHaveLength(0);
    expect(report.rejected.map((r) => r.reason)).toEqual(['too_short', 'not_a_question']);
  });

  it('rejects a prompt nobody would type', async () => {
    const long = 'what is the very best possible budget barlow pocket knife that i could buy today under forty dollars';
    const writer = writerOf([long]);
    const report = await generatePrompts([seeds[0]!], context, writer, { perSeed: 1 });
    expect(report.rejected[0]!.reason).toBe('too_long');
  });

  it('caps a cluster so one category cannot eat the budget', async () => {
    const writer = writerOf([
      'best budget barlow pocket knife under $40',
      'which barlow knife holds an edge longest',
      'how thick is a barlow knife blade',
      'where to buy a barlow knife in michigan',
    ]);
    const report = await generatePrompts([seeds[0]!], context, writer, {
      perSeed: 4,
      maxPerCluster: 2,
    });

    expect(report.prompts).toHaveLength(2);
    expect(report.rejected.filter((r) => r.reason === 'over_cluster_cap')).toHaveLength(2);
  });

  it('keeps the intents the ranker values when the total cap bites', async () => {
    const writer = writerOf(
      ['how sharp is a barlow knife blade normally', 'best budget barlow pocket knife under $40'],
      ['which hunting knife is better for whitetail deer', 'how heavy is a hunting knife usually'],
    );
    const report = await generatePrompts(seeds, context, writer, {
      perSeed: 2,
      maxTotal: 2,
      intents: ['commercial', 'comparison', 'informational'],
    });

    expect(report.prompts.map((p) => p.intent)).toEqual(['commercial', 'comparison']);
    expect(report.rejected.filter((r) => r.reason === 'over_total_cap')).toHaveLength(2);
  });

  it('reports what the set will cost every week', async () => {
    const writer = writerOf(['best budget barlow pocket knife under $40']);
    const report = await generatePrompts([seeds[0]!], context, writer, { perSeed: 1 });
    expect(report.weeklyCallsPerEngine).toBe(3);
    expect(weeklyCost(60, 2)).toBe(360);
  });

  it('does not repeat prompts the project already has', async () => {
    const writer = writerOf(['best budget barlow pocket knife under $40']);
    const report = await generatePrompts([seeds[0]!], context, writer, {
      perSeed: 1,
      existing: ['best budget barlow pocket knife under $40'],
    });
    expect(report.prompts).toHaveLength(0);
    expect(report.rejected[0]!.reason).toBe('duplicate');
  });
});

describe('OpenAIPromptWriter', () => {
  function responding(text: string, status = 200): typeof fetch {
    return vi.fn(async () =>
      new Response(
        JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    ) as never;
  }

  it('strips the numbering and quotes models add despite being asked not to', async () => {
    const writer = new OpenAIPromptWriter({
      apiKey: 'k',
      fetchImpl: responding(
        '1. best budget barlow pocket knife under $40\n' +
          '- "which barlow holds an edge longest"\n' +
          '• where to buy a barlow knife in michigan\n',
      ),
    });

    expect(await writer.write({ seed: { text: 'Barlow', cluster: 'c' }, topic: 't', intents: ['commercial'], count: 5 }))
      .toEqual([
        'best budget barlow pocket knife under $40',
        'which barlow holds an edge longest',
        'where to buy a barlow knife in michigan',
      ]);
  });

  it('never sends a web search tool — this is a writing task, not retrieval', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(JSON.stringify({ output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await new OpenAIPromptWriter({ apiKey: 'k', fetchImpl: fetchImpl as never }).write({
      seed: { text: 'Barlow', cluster: 'c' },
      topic: 't',
      intents: ['commercial'],
      count: 2,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body).not.toHaveProperty('tools');
    expect(body.instructions).toContain('Never name a specific shop');
  });

  it('honours the requested count', async () => {
    const writer = new OpenAIPromptWriter({
      apiKey: 'k',
      fetchImpl: responding('one two three four\nfive six seven eight\nnine ten eleven twelve'),
    });
    const out = await writer.write({
      seed: { text: 'Barlow', cluster: 'c' },
      topic: 't',
      intents: ['commercial'],
      count: 2,
    });
    expect(out).toHaveLength(2);
  });

  it('surfaces an API failure as a typed error', async () => {
    const writer = new OpenAIPromptWriter({ apiKey: 'k', fetchImpl: responding('nope', 429) });
    const error = await writer
      .write({ seed: { text: 'x', cluster: 'c' }, topic: 't', intents: ['commercial'], count: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).retryable).toBe(true);
  });

  it('refuses to construct without a key', () => {
    expect(() => new OpenAIPromptWriter({ apiKey: '  ' })).toThrow(EngineError);
  });
});

describe('TemplatePromptWriter', () => {
  const writer = new TemplatePromptWriter();

  it('produces a mix rather than variations of one question', async () => {
    const out = await writer.write({
      seed: { text: 'Rough Rider Barlow', cluster: 'c' },
      topic: 't',
      intents: ['commercial', 'comparison', 'informational'],
      count: 3,
    });
    expect(out.map((p) => classifyIntent(p))).toEqual([
      'commercial',
      'comparison',
      'informational',
    ]);
  });

  it('writes output the generator accepts', async () => {
    // The point of the template writer is exercising the real pipeline, so
    // what it emits has to survive the same validation a model's output does.
    const report = await generatePrompts(
      [{ text: 'Rough Rider Barlow', cluster: 'pocket knives' }],
      context,
      writer,
      { perSeed: 3 },
    );
    expect(report.prompts).toHaveLength(3);
    expect(report.rejected).toEqual([]);
  });

  it('stops when the templates run out rather than repeating', async () => {
    const out = await writer.write({
      seed: { text: 'Barlow', cluster: 'c' },
      topic: 't',
      intents: ['comparison'],
      count: 10,
    });
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(out.length);
  });
});
