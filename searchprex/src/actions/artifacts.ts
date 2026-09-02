import type { Gap } from '../gaps/types.js';
import { firstHeadingOf, titleOf } from '../crawl/links.js';
import type {
  CrawlFixArtifact,
  Fact,
  InternalLinkArtifact,
  PlacementArtifact,
  SchemaArtifact,
} from './types.js';

/**
 * Deterministic artifact builders.
 *
 * Most of what the Action Engine produces needs no model at all: a robots.txt
 * line, a JSON-LD block, a list of pages to link from. Generating these with an
 * LLM would add cost, latency and a fabrication risk to work that has exactly
 * one correct answer.
 */

export function buildCrawlFix(gap: Gap): CrawlFixArtifact {
  const layer = gap.evidence['layer'] === 'edge' ? 'edge' : 'robots';
  const userAgents = Array.isArray(gap.evidence['userAgents'])
    ? (gap.evidence['userAgents'] as string[])
    : [];

  if (gap.gapType === 'js_only') {
    return {
      kind: 'crawl_fix',
      layer: 'robots',
      robotsAdditions: [],
      note:
        'The answer content exists only after JavaScript runs. Server-render it, ' +
        'or emit the answer block into the initial HTML. AI crawlers execute less ' +
        'JavaScript than Googlebot, so content that appears only after hydration ' +
        'is frequently not there at all for the retriever.',
    };
  }

  if (layer === 'edge') {
    return {
      kind: 'crawl_fix',
      layer: 'edge',
      robotsAdditions: [],
      note:
        `The site edge returns a block to ${userAgents.join(', ')} while robots.txt ` +
        'allows them. This is a WAF or CDN rule, not a robots.txt problem — editing ' +
        'robots.txt will not change it. On Cloudflare check the "Block AI bots" ' +
        'setting and any custom bot-fight rules; allow these agents explicitly.',
    };
  }

  return {
    kind: 'crawl_fix',
    layer: 'robots',
    robotsAdditions: userAgents.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    note:
      `robots.txt disallows ${userAgents.join(', ')}, which this engine needs in order ` +
      'to retrieve the page. Add an explicit allow group; a named group takes ' +
      'precedence over the wildcard block already in the file.',
  };
}

export interface SchemaInput {
  url: string;
  html: string;
  brandName: string;
  types: string[];
  facts: Fact[];
}

/**
 * Build JSON-LD from what the page and the fact sheet actually contain.
 *
 * Fields are omitted rather than invented. That matters most for `offers`:
 * Product markup carrying a price that does not match the page is a
 * structured-data violation and a manual-action risk, so a price is emitted
 * only when a price fact was supplied.
 */
export function buildSchema(input: SchemaInput): SchemaArtifact {
  const name = firstHeadingOf(input.html) ?? titleOf(input.html) ?? input.brandName;
  const wantsProduct = input.types.includes('Product');

  const jsonLd: Record<string, unknown> = wantsProduct
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name,
        url: input.url,
        brand: { '@type': 'Brand', name: input.brandName },
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        url: input.url,
        mainEntity: [],
      };

  if (wantsProduct) {
    const price = findFact(input.facts, ['price', 'cost']);
    const availability = findFact(input.facts, ['availability', 'stock', 'in stock']);
    const sku = findFact(input.facts, ['sku', 'mpn', 'part number']);

    if (sku !== undefined) jsonLd['sku'] = sku.value;
    if (price !== undefined) {
      jsonLd['offers'] = {
        '@type': 'Offer',
        price: price.value.replace(/[^\d.]/g, ''),
        priceCurrency: 'USD',
        url: input.url,
        ...(availability === undefined
          ? {}
          : { availability: `https://schema.org/${normaliseAvailability(availability.value)}` }),
      };
    }

    const material = findFact(input.facts, ['steel', 'material', 'blade']);
    if (material !== undefined) jsonLd['material'] = material.value;
  }

  return {
    kind: 'schema',
    types: [String(jsonLd['@type'])],
    jsonLd,
    html: `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`,
  };
}

function normaliseAvailability(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('out')) return 'OutOfStock';
  if (lower.includes('order') || lower.includes('backorder')) return 'BackOrder';
  return 'InStock';
}

function findFact(facts: Fact[], keywords: string[]): Fact | undefined {
  return facts.find((fact) => {
    const haystack = `${fact.claim} ${(fact.topic ?? []).join(' ')}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

export interface LinkSource {
  url: string;
  title: string | null;
}

export function buildInternalLink(
  gap: Gap,
  targetUrl: string,
  sources: LinkSource[],
): InternalLinkArtifact {
  const anchors = anchorsFor(gap.prompt);
  return {
    kind: 'internal_link',
    targetUrl,
    anchors,
    // Hub and category pages first: a link from a page that is itself well
    // linked passes more than one from another orphan.
    sourceUrls: sources
      .filter((source) => source.url !== targetUrl)
      .slice(0, 5)
      .map((source) => source.url),
  };
}

/**
 * Anchor suggestions from the prompt itself. Descriptive anchors, never "click
 * here": the anchor is one of the few places we can restate what the target
 * page answers.
 */
function anchorsFor(prompt: string): string[] {
  const cleaned = prompt
    .replace(/^(?:how|what|which|why|when|where|who|is|are|does|do)\b\s*/i, '')
    .replace(/\?+$/, '')
    .trim();
  if (cleaned === '') return [];

  return [...new Set([cleaned, cleaned.replace(/^(?:long|much|many)\s+/i, '').trim()])].filter(
    (anchor) => anchor !== '',
  );
}

export function buildPlacement(gap: Gap, pitch: string | null): PlacementArtifact {
  const raw = gap.evidence['placementTargets'];
  const domains = Array.isArray(raw) ? (raw as string[]) : [];

  return {
    kind: 'placement',
    // Citation counts arrive from the aggregate view; per-gap we only know the
    // domain appeared for this prompt, so the count starts at one and is
    // summed across the prompt set by the caller.
    targets: domains.map((domain) => ({ domain, citationCount: 1 })),
    pitch,
  };
}
