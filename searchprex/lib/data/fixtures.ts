import type { ActionArtifact } from '@/src/actions/types';
import { getFixtureStatus } from '@/lib/data/fixture-state';
import type {
  ActionRow,
  CohortSummary,
  DataSource,
  PlacementRow,
  ProjectSummary,
  PromptRow,
  ProofRow,
  RefusalRow,
} from '@/lib/data/types';

/**
 * Seed data for the MSO storefront.
 *
 * This exists so the screens can be built and reviewed before Supabase is
 * wired. It is shaped exactly like what the pipeline produces — the numbers are
 * illustrative, the structure is not. Every screen reads through `DataSource`,
 * so swapping this for a Supabase implementation touches no component.
 */

const PROJECT: ProjectSummary = {
  slug: 'mso',
  name: 'Michigan Sports Outdoor',
  domain: 'michigansportsoutdoor.com',
  topic: 'knives and outdoor gear',
  lastRunAt: '2026-09-01T06:00:00.000Z',
  citationsGained: 14,
  promptCount: 48,
  engines: ['perplexity', 'openai'],
  cmsKind: 'shopify',
};

const PROMPTS: PromptRow[] = [
  {
    id: 'p1',
    text: 'best budget barlow pocket knife under $40',
    intent: 'commercial',
    cluster: 'budget pocket knives',
    engines: [
      { engine: 'perplexity', verdict: 'absent', cited: 0, total: 3 },
      { engine: 'openai', verdict: 'absent', cited: 0, total: 3 },
    ],
    rivals: ['bladehq.com', 'smkw.com'],
  },
  {
    id: 'p2',
    text: 'how long does a 1095 carbon steel blade stay sharp',
    intent: 'informational',
    cluster: 'blade steel',
    engines: [
      { engine: 'perplexity', verdict: 'contested', cited: 1, total: 3 },
      { engine: 'openai', verdict: 'absent', cited: 0, total: 3 },
    ],
    rivals: ['knifecenter.com'],
  },
  {
    id: 'p3',
    text: 'rough rider vs case pocket knives which is better value',
    intent: 'comparison',
    cluster: 'brand comparison',
    engines: [
      { engine: 'perplexity', verdict: 'absent', cited: 0, total: 3 },
      { engine: 'openai', verdict: 'contested', cited: 1, total: 3 },
    ],
    rivals: ['bladehq.com', 'chicagoknifeworks.com'],
  },
  {
    id: 'p4',
    text: 'where to buy cold steel knives online in michigan',
    intent: 'commercial',
    cluster: 'local intent',
    engines: [
      { engine: 'perplexity', verdict: 'cited', cited: 3, total: 3 },
      { engine: 'openai', verdict: 'contested', cited: 2, total: 3 },
    ],
    rivals: [],
  },
  {
    id: 'p5',
    text: 'is michigan sports outdoor a legitimate knife retailer',
    intent: 'brand',
    cluster: 'brand trust',
    engines: [
      { engine: 'perplexity', verdict: 'cited', cited: 3, total: 3 },
      { engine: 'openai', verdict: 'cited', cited: 3, total: 3 },
    ],
    rivals: [],
  },
  {
    id: 'p6',
    text: 'what knife blade length is legal to carry in michigan',
    intent: 'informational',
    cluster: 'knife laws',
    engines: [
      { engine: 'perplexity', verdict: 'absent', cited: 0, total: 3 },
      { engine: 'openai', verdict: 'absent', cited: 0, total: 3 },
    ],
    rivals: ['bladehq.com'],
  },
  {
    id: 'p7',
    text: 'best fixed blade hunting knife for whitetail deer',
    intent: 'commercial',
    cluster: 'hunting knives',
    engines: [
      { engine: 'perplexity', verdict: 'absent', cited: 0, total: 3 },
      { engine: 'openai', verdict: 'unknown', cited: 0, total: 0 },
    ],
    rivals: ['smkw.com', 'opticsplanet.com'],
  },
  {
    id: 'p8',
    text: 'mag-lite vs streamlight which flashlight lasts longer',
    intent: 'comparison',
    cluster: 'flashlights',
    engines: [
      { engine: 'perplexity', verdict: 'contested', cited: 2, total: 3 },
      { engine: 'openai', verdict: 'absent', cited: 0, total: 3 },
    ],
    rivals: ['opticsplanet.com'],
  },
];

const PREVIEW_BLOCK = `<section class="sp-answer">
  <h2>How long does a 1095 carbon steel blade stay sharp?</h2>
  <p>A 1095 carbon steel blade holds a working edge for roughly two weeks of
     daily cutting before it needs a strop, and about six weeks before a full
     sharpen. We test every blade on manila rope in store before it ships, so
     the edge you receive is the one we measured on that batch.</p>
  <ul>
    <li>Blade steel: 1095 carbon, 56–58 HRC</li>
    <li>Tested in store before dispatch</li>
  </ul>
</section>`;

const PREVIEW_SCHEMA = `{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Rough Rider Barlow",
  "url": "https://michigansportsoutdoor.com/products/rough-rider-barlow",
  "brand": { "@type": "Brand", "name": "Michigan Sports Outdoor" },
  "material": "1095 carbon steel",
  "offers": {
    "@type": "Offer",
    "price": "38.99",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}`;

const PREVIEW_ROBOTS = `# Added by Searchprex: allow AI answer engines to retrieve pages
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /`;

type FixtureAction = ActionRow & { coreArtifact: ActionArtifact | null };

const ACTIONS: FixtureAction[] = [
  {
    id: 'a1',
    actionType: 'crawl_fix',
    gapType: 'bot_blocked',
    gate: 1,
    prompt: 'best budget barlow pocket knife under $40',
    engine: 'openai',
    targetUrl: 'https://michigansportsoutdoor.com/products/rough-rider-barlow',
    priority: 4.5,
    certainty: 'proven',
    rationale:
      'The site edge returns 403 to OAI-SearchBot while robots.txt allows it. This is a ' +
      'CDN rule, not a robots.txt problem — no content change can work around it.',
    status: 'draft',
    preview: { label: 'robots.txt addition', body: PREVIEW_ROBOTS },
    coreArtifact: {
      kind: 'crawl_fix',
      layer: 'robots',
      robotsAdditions: ['User-agent: OAI-SearchBot', 'Allow: /', '', 'User-agent: ChatGPT-User', 'Allow: /', ''],
      note: 'robots.txt disallows crawlers this engine needs.',
    },
  },
  {
    id: 'a2',
    actionType: 'placement',
    gapType: 'rival_corroborated',
    gate: 4,
    prompt: 'best budget barlow pocket knife under $40',
    engine: 'perplexity',
    targetUrl: null,
    priority: 3.0,
    certainty: 'proven',
    rationale:
      'Every source this engine trusts for the topic backs a competitor. 6 third-party ' +
      'domains cited, none mentioning this store.',
    status: 'draft',
    preview: {
      label: 'Placement targets',
      body: 'reddit.com/r/knifeclub · bladeforums.com · everydaycarry.com\nyoutube.com · knifeinformer.com · thetruthaboutknives.com',
    },
    // Placement is an outreach task, not a file change: no deploy artifact.
    coreArtifact: null,
  },
  {
    id: 'a3',
    actionType: 'answer_block',
    gapType: 'weak_passage',
    gate: 3,
    prompt: 'how long does a 1095 carbon steel blade stay sharp',
    engine: 'openai',
    targetUrl: 'https://michigansportsoutdoor.com/products/rough-rider-barlow',
    priority: 2.0,
    certainty: 'proven',
    rationale:
      'The engine answers from a competitor passage. This block states the same answer ' +
      'from first-party facts, in the 40–90 word shape retrievers extract.',
    status: 'approved',
    preview: { label: 'Generated block', body: PREVIEW_BLOCK },
    coreArtifact: {
      kind: 'answer_block',
      question: 'How long does a 1095 carbon steel blade stay sharp?',
      answer:
        'A 1095 carbon steel blade holds a working edge for roughly two weeks of daily ' +
        'cutting before it needs a strop, and about six weeks before a full sharpen. We ' +
        'test every blade on manila rope in store before it ships, so the edge you ' +
        'receive is the one we measured on that batch.',
      supporting: ['Blade steel: 1095 carbon, 56–58 HRC', 'Tested in store before dispatch'],
      factsUsed: ['blade steel', 'edge retention'],
      html: PREVIEW_BLOCK,
    },
  },
  {
    id: 'a4',
    actionType: 'schema',
    gapType: 'no_schema',
    gate: 3,
    prompt: 'best budget barlow pocket knife under $40',
    engine: 'perplexity',
    targetUrl: 'https://michigansportsoutdoor.com/products/rough-rider-barlow',
    priority: 1.47,
    certainty: 'strong',
    rationale: 'Page carries none of the expected schema types.',
    status: 'draft',
    preview: { label: 'JSON-LD', body: PREVIEW_SCHEMA },
    coreArtifact: {
      kind: 'schema',
      types: ['Product'],
      jsonLd: JSON.parse(PREVIEW_SCHEMA) as Record<string, unknown>,
      html: `<script type="application/ld+json">${PREVIEW_SCHEMA}</script>`,
    },
  },
  {
    id: 'a5',
    actionType: 'internal_link',
    gapType: 'orphan',
    gate: 3,
    prompt: 'best fixed blade hunting knife for whitetail deer',
    engine: 'perplexity',
    targetUrl: 'https://michigansportsoutdoor.com/products/buck-119-special',
    priority: 0.73,
    certainty: 'strong',
    rationale: 'Page has 1 internal inbound link; below 3 it is not crawled reliably.',
    status: 'draft',
    preview: {
      label: 'Suggested links',
      body:
        'From /collections/hunting-knives → anchor "fixed blade hunting knife for whitetail deer"\n' +
        'From /collections/buck-knives → anchor "Buck 119 Special"\n' +
        'From /blog/deer-season-gear → anchor "fixed blade for field dressing"',
    },
    // Internal linking edits other pages; V0 deploys only the three types below.
    coreArtifact: null,
  },
  {
    id: 'a6',
    actionType: 'rank_first',
    gapType: 'not_ranking',
    gate: 2,
    prompt: 'what knife blade length is legal to carry in michigan',
    engine: 'perplexity',
    targetUrl: 'https://michigansportsoutdoor.com/pages/knife-laws',
    priority: 0.5,
    certainty: 'proven',
    rationale:
      'This page ranks at position 41, below the range engines retrieve from. No on-page ' +
      'copy will change that — fix the classic ranking first.',
    status: 'draft',
    preview: null,
    coreArtifact: null,
  },
];

/**
 * A miniature repository, so the deploy planner has real files to diff against
 * in the fixture environment. Paths match `staticSiteResolver`.
 */
export const fixtureRepo: Record<string, string> = {
  'robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://michigansportsoutdoor.com/sitemap.xml\n',
  'products/rough-rider-barlow.html': `<html>
  <head>
    <title>Rough Rider Barlow | Michigan Sports Outdoor</title>
  </head>
  <body>
    <main>
      <h1>Rough Rider Barlow</h1>
      <p>Classic two-blade barlow pattern with jigged bone scales.</p>
    </main>
    <footer>© Michigan Sports Outdoor</footer>
  </body>
</html>`,
};

export const fixtureActions = ACTIONS;

/**
 * Catalogue seeds for the fixture environment, standing in for what a crawl
 * would return. Real generation seeds from the customer's own product and
 * category pages — never from the topic — so the stand-in is shaped the same.
 */
export const fixtureSeeds = [
  { text: 'Rough Rider Barlow', cluster: 'pocket knives' },
  { text: 'Buck 119 Special', cluster: 'hunting knives' },
  { text: 'Cold Steel Recon 1', cluster: 'tactical knives' },
  { text: 'Mag-Lite ML300L', cluster: 'flashlights' },
];

export const fixturePrompts = PROMPTS;

const REFUSALS: RefusalRow[] = [
  {
    id: 'r1',
    actionType: 'answer_block',
    reason: 'no_first_party_facts',
    prompt: 'rough rider vs case pocket knives which is better value',
    engine: 'perplexity',
    needed:
      'A first-party fact about this comparison — your own return rate, a warranty ' +
      'difference, a spec you verified in store. Without one, any block generated here ' +
      'would restate the competitor page that is already cited.',
  },
  {
    id: 'r2',
    actionType: 'answer_block',
    reason: 'not_retrievable',
    prompt: 'best budget barlow pocket knife under $40',
    engine: 'openai',
    needed:
      'Fix the crawler block first. Until then the engine cannot retrieve this page, so ' +
      'a generated block would sit on it unread.',
  },
  {
    id: 'r3',
    actionType: 'answer_block',
    reason: 'duplicate_of_existing',
    prompt: 'mag-lite vs streamlight which flashlight lasts longer',
    engine: 'openai',
    needed:
      'The writer could not produce an answer that says something the already-cited ' +
      'competitor page does not. Supply a runtime figure you measured yourself.',
  },
];

const PLACEMENTS: PlacementRow[] = [
  { domain: 'reddit.com', promptsCovered: 21, citationCount: 47, rivalPresent: true, examplePrompt: 'best budget barlow pocket knife under $40' },
  { domain: 'bladeforums.com', promptsCovered: 14, citationCount: 29, rivalPresent: true, examplePrompt: 'rough rider vs case pocket knives which is better value' },
  { domain: 'everydaycarry.com', promptsCovered: 11, citationCount: 22, rivalPresent: true, examplePrompt: 'best budget barlow pocket knife under $40' },
  { domain: 'youtube.com', promptsCovered: 9, citationCount: 18, rivalPresent: false, examplePrompt: 'best fixed blade hunting knife for whitetail deer' },
  { domain: 'knifeinformer.com', promptsCovered: 8, citationCount: 15, rivalPresent: true, examplePrompt: 'how long does a 1095 carbon steel blade stay sharp' },
  { domain: 'thetruthaboutknives.com', promptsCovered: 5, citationCount: 9, rivalPresent: false, examplePrompt: 'rough rider vs case pocket knives which is better value' },
  { domain: 'outdoorlife.com', promptsCovered: 4, citationCount: 7, rivalPresent: true, examplePrompt: 'best fixed blade hunting knife for whitetail deer' },
  { domain: 'michigan.gov', promptsCovered: 3, citationCount: 6, rivalPresent: false, examplePrompt: 'what knife blade length is legal to carry in michigan' },
];

const PROOF: ProofRow[] = [
  {
    id: 'l1',
    actionType: 'answer_block',
    prompt: 'where to buy cold steel knives online in michigan',
    deployedAt: '2026-08-12T00:00:00.000Z',
    measuredAt: '2026-08-26T00:00:00.000Z',
    engines: [
      { engine: 'perplexity', before: { cited: 0, total: 3 }, after: { cited: 3, total: 3 }, direction: 'gained', confident: true },
      { engine: 'openai', before: { cited: 0, total: 3 }, after: { cited: 2, total: 3 }, direction: 'improved', confident: false },
    ],
    isControl: false,
    deferredReason: null,
  },
  {
    id: 'l2',
    actionType: 'crawl_fix',
    prompt: 'is michigan sports outdoor a legitimate knife retailer',
    deployedAt: '2026-08-10T00:00:00.000Z',
    measuredAt: '2026-08-24T00:00:00.000Z',
    engines: [
      { engine: 'perplexity', before: { cited: 0, total: 3 }, after: { cited: 3, total: 3 }, direction: 'gained', confident: true },
      { engine: 'openai', before: { cited: 1, total: 3 }, after: { cited: 3, total: 3 }, direction: 'improved', confident: false },
    ],
    isControl: false,
    deferredReason: null,
  },
  {
    id: 'l3',
    actionType: 'schema',
    prompt: 'mag-lite vs streamlight which flashlight lasts longer',
    deployedAt: '2026-08-14T00:00:00.000Z',
    measuredAt: '2026-08-28T00:00:00.000Z',
    engines: [
      { engine: 'perplexity', before: { cited: 2, total: 3 }, after: { cited: 2, total: 3 }, direction: 'unchanged', confident: false },
    ],
    isControl: false,
    deferredReason: null,
  },
  {
    id: 'l4',
    actionType: 'answer_block',
    prompt: 'best fixed blade hunting knife for whitetail deer',
    deployedAt: '2026-08-22T00:00:00.000Z',
    measuredAt: null,
    engines: [
      { engine: 'perplexity', before: { cited: 0, total: 3 }, after: null, direction: null, confident: false },
    ],
    isControl: false,
    deferredReason: 'the block is not on the live page — the pull request may be unmerged',
  },
  {
    id: 'l5',
    actionType: 'answer_block',
    prompt: 'what knife blade length is legal to carry in michigan',
    deployedAt: '2026-08-12T00:00:00.000Z',
    measuredAt: '2026-08-26T00:00:00.000Z',
    engines: [
      { engine: 'perplexity', before: { cited: 0, total: 3 }, after: { cited: 1, total: 3 }, direction: 'improved', confident: false },
    ],
    isControl: true,
    deferredReason: null,
  },
  {
    id: 'l6',
    actionType: 'answer_block',
    prompt: 'rough rider vs case pocket knives which is better value',
    deployedAt: '2026-08-12T00:00:00.000Z',
    measuredAt: '2026-08-26T00:00:00.000Z',
    engines: [
      { engine: 'openai', before: { cited: 1, total: 3 }, after: { cited: 1, total: 3 }, direction: 'unchanged', confident: false },
    ],
    isControl: true,
    deferredReason: null,
  },
];

const COHORT: CohortSummary = {
  treatedCount: 18,
  controlCount: 6,
  treatedDelta: 0.61,
  controlDelta: 0.17,
  netLift: 0.44,
  hasControl: true,
};

export const fixtureDataSource: DataSource = {
  project: async () => PROJECT,
  prompts: async () => PROMPTS,
  actions: async () =>
    ACTIONS.map((action) => ({
      ...action,
      status: getFixtureStatus(action.id, action.status as 'draft' | 'approved' | 'deployed' | 'rejected'),
    }))
      .filter((action) => action.status !== 'rejected')
      .sort((a, b) => b.priority - a.priority),
  refusals: async () => REFUSALS,
  placements: async () => PLACEMENTS,
  proof: async () => PROOF,
  cohort: async () => COHORT,
  // Nothing is connected in the fixture environment, and saying so is more
  // useful than inventing a connection that cannot be used.
  connection: async () => null,
  properties: async () => [],
};
