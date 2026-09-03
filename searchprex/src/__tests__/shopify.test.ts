import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROBOTS_TEMPLATE,
  ROBOTS_TEMPLATE_KEY,
  applyShopifyPlan,
  buildShopifyPlan,
  rollbackShopifyDeploy,
} from '../deploy/shopify.js';
import { RestShopifyClient, handleFromUrl } from '../deploy/shopify-client.js';
import { blockId, markedIds } from '../deploy/markers.js';
import type { ShopifyClient, ShopifyProduct } from '../deploy/shopify-client.js';
import type { Action, AnswerBlockArtifact, CrawlFixArtifact } from '../actions/types.js';

const BLOCK: AnswerBlockArtifact = {
  kind: 'answer_block',
  question: 'How long does a barlow blade stay sharp?',
  answer: 'About two weeks in 1095 carbon steel.',
  supporting: [],
  factsUsed: ['blade steel'],
  html: '<section class="sp-answer"><p>About two weeks.</p></section>',
};

const CRAWL_FIX: CrawlFixArtifact = {
  kind: 'crawl_fix',
  layer: 'robots',
  robotsAdditions: ['User-agent: OAI-SearchBot', 'Allow: /', ''],
  note: '',
};

function action(over: Partial<Action> = {}): Action {
  return {
    actionType: 'answer_block',
    gap: {
      prompt: 'how long does a barlow blade stay sharp',
      engine: 'perplexity',
      gapType: 'weak_passage',
      blockedAtGate: 3,
      ourUrl: 'https://mso.myshopify.com/products/rough-rider-barlow',
      rivalUrl: null,
      certainty: 'proven',
      evidence: {},
    },
    targetUrl: 'https://mso.myshopify.com/products/rough-rider-barlow',
    priority: 3,
    certainty: 'proven',
    artifact: BLOCK,
    rationale: 'states the answer from first-party facts',
    ...over,
  };
}

function fakeClient(over: Partial<ShopifyClient> = {}, product?: ShopifyProduct) {
  const products = new Map<string, ShopifyProduct>();
  if (product !== undefined) products.set(product.handle, product);
  const assets = new Map<string, string>();
  const writes: { kind: string; ref: string; value: string }[] = [];

  const client: ShopifyClient = {
    productByHandle: async (handle) => products.get(handle) ?? null,
    updateProductBody: async (id, html) => {
      writes.push({ kind: 'product', ref: String(id), value: html });
      for (const p of products.values()) if (p.id === id) p.bodyHtml = html;
    },
    mainThemeId: async () => 900,
    getAsset: async (_theme, key) =>
      assets.has(key) ? { key, value: assets.get(key)! } : null,
    putAsset: async (_theme, key, value) => {
      assets.set(key, value);
      writes.push({ kind: 'asset', ref: key, value });
    },
    ...over,
  };

  return { client, writes, assets, products };
}

const PRODUCT: ShopifyProduct = {
  id: 111,
  handle: 'rough-rider-barlow',
  title: 'Rough Rider Barlow',
  bodyHtml: '<p>Classic two-blade barlow with jigged bone scales.</p>',
};

describe('handleFromUrl', () => {
  it('reads the handle from both product URL shapes', () => {
    // Shopify serves the same product under two paths; both are one product.
    expect(handleFromUrl('https://s.com/products/rough-rider-barlow')).toBe('rough-rider-barlow');
    expect(handleFromUrl('https://s.com/collections/knives/products/rough-rider-barlow?v=1')).toBe(
      'rough-rider-barlow',
    );
  });

  it('returns null for anything that is not a product page', () => {
    expect(handleFromUrl('https://s.com/pages/about')).toBeNull();
    expect(handleFromUrl('not a url')).toBeNull();
  });
});

describe('buildShopifyPlan — answer blocks', () => {
  it('appends the block to the product description', async () => {
    const { client } = fakeClient({}, { ...PRODUCT });
    const plan = await buildShopifyPlan([action()], client);

    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0]!;
    expect(change.kind).toBe('product');
    expect(change.before).toBe(PRODUCT.bodyHtml);
    expect(change.after).toContain('sp-answer');
    expect(change.after.startsWith(PRODUCT.bodyHtml)).toBe(true);
  });

  it('is idempotent — a second deploy replaces rather than duplicates', async () => {
    const { client, products } = fakeClient({}, { ...PRODUCT });
    const first = await buildShopifyPlan([action()], client);
    await applyShopifyPlan(first, client);

    const second = await buildShopifyPlan([action()], client);
    expect(second.changes).toHaveLength(0);
    expect(markedIds(products.get('rough-rider-barlow')!.bodyHtml)).toEqual([
      blockId(BLOCK.question),
    ]);
  });

  it('skips a product that is not in the store', async () => {
    const { client } = fakeClient({});
    const plan = await buildShopifyPlan([action()], client);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('no product with handle');
  });

  it('caps blocks per run', async () => {
    const { client } = fakeClient({}, { ...PRODUCT });
    const many = [1, 2, 3].map((i) =>
      action({ priority: 4 - i, artifact: { ...BLOCK, question: `Question ${String(i)}?` } }),
    );
    const plan = await buildShopifyPlan(many, client, { maxBlocksPerRun: 2 });

    expect(plan.cappedCount).toBe(1);
    expect(plan.changes[0]!.applied).toHaveLength(2);
  });

  it('refuses schema, because the theme already emits Product markup', async () => {
    // The same duplicate-type conflict the git target refuses.
    const { client } = fakeClient({}, { ...PRODUCT });
    const plan = await buildShopifyPlan(
      [
        action({
          actionType: 'schema',
          artifact: { kind: 'schema', types: ['Product'], jsonLd: {}, html: '<script></script>' },
        }),
      ],
      client,
    );

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('already emits Product schema');
  });
});

describe('buildShopifyPlan — robots.txt', () => {
  const crawlAction = action({
    actionType: 'crawl_fix',
    artifact: CRAWL_FIX,
    targetUrl: null,
  });

  it('keeps Shopify defaults when the template does not exist yet', async () => {
    // Writing a template with only our allow group would delete every default
    // rule and expose /cart, /checkout and /account to crawlers.
    const { client } = fakeClient({});
    const plan = await buildShopifyPlan([crawlAction], client);

    const change = plan.changes[0]!;
    expect(change.kind).toBe('asset');
    expect(change.before).toBe('');
    expect(change.after).toContain('robots.default_groups');
    expect(change.after).toContain('User-agent: OAI-SearchBot');
  });

  it('extends an existing template rather than replacing it', async () => {
    const { client, assets } = fakeClient({});
    assets.set(ROBOTS_TEMPLATE_KEY, 'User-agent: *\nDisallow: /admin\n');

    const plan = await buildShopifyPlan([crawlAction], client);
    const change = plan.changes[0]!;
    expect(change.after).toContain('Disallow: /admin');
    expect(change.after).toContain('User-agent: OAI-SearchBot');
  });

  it('says plainly that an edge block is not fixable here', async () => {
    const { client } = fakeClient({});
    const plan = await buildShopifyPlan(
      [
        action({
          actionType: 'crawl_fix',
          targetUrl: null,
          artifact: { kind: 'crawl_fix', layer: 'edge', robotsAdditions: [], note: '' },
        }),
      ],
      client,
    );
    expect(plan.skipped[0]!.reason).toContain('Shopify support');
  });

  it('writes the published theme, never a draft one', async () => {
    const mainThemeId = vi.fn(async () => 900);
    const { client, writes } = fakeClient({ mainThemeId });
    const plan = await buildShopifyPlan([crawlAction], client);
    await applyShopifyPlan(plan, client);

    expect(mainThemeId).toHaveBeenCalled();
    expect(writes[0]!.ref).toBe(ROBOTS_TEMPLATE_KEY);
  });
});

describe('applyShopifyPlan and rollback', () => {
  it('records the previous content before writing', async () => {
    const { client } = fakeClient({}, { ...PRODUCT });
    const plan = await buildShopifyPlan([action()], client);
    const record = await applyShopifyPlan(plan, client);

    expect(record.changes[0]!.before).toBe(PRODUCT.bodyHtml);
  });

  it('restores the description on rollback', async () => {
    const { client, products } = fakeClient({}, { ...PRODUCT });
    const plan = await buildShopifyPlan([action()], client);
    const record = await applyShopifyPlan(plan, client);
    expect(products.get('rough-rider-barlow')!.bodyHtml).toContain('sp-answer');

    await rollbackShopifyDeploy(record, client);
    expect(products.get('rough-rider-barlow')!.bodyHtml).toBe(PRODUCT.bodyHtml);
  });

  it('restores robots to Shopify defaults when there was no template before', async () => {
    // An empty template would leave a robots.txt that allows everything —
    // worse than the state being undone.
    const { client, assets } = fakeClient({});
    const plan = await buildShopifyPlan(
      [action({ actionType: 'crawl_fix', artifact: CRAWL_FIX, targetUrl: null })],
      client,
    );
    const record = await applyShopifyPlan(plan, client);
    await rollbackShopifyDeploy(record, client);

    expect(assets.get(ROBOTS_TEMPLATE_KEY)).toBe(DEFAULT_ROBOTS_TEMPLATE);
  });

  it('stops at the first failure rather than half-applying a catalogue', async () => {
    const { client } = fakeClient(
      {
        updateProductBody: async () => {
          throw new Error('422 Unprocessable');
        },
      },
      { ...PRODUCT },
    );
    const plan = await buildShopifyPlan([action()], client);
    await expect(applyShopifyPlan(plan, client)).rejects.toThrow('422');
  });
});

describe('RestShopifyClient', () => {
  function response(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  it('sends the token as a header and never in the URL', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        response({ products: [{ id: 1, handle: 'h', title: 't', body_html: '<p>x</p>' }] }),
    );
    await new RestShopifyClient({
      shop: 'mso.myshopify.com',
      accessToken: 'shpat_secret',
      fetchImpl: fetchImpl as never,
    }).productByHandle('h');

    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain('shpat_secret');
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Shopify-Access-Token']).toBe('shpat_secret');
  });

  it('slows down as the leaky bucket fills', async () => {
    // A 429 partway through a batch leaves some products updated and some not.
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      response({ products: [] }, { 'x-shopify-shop-api-call-limit': '38/40' }),
    );
    const client = new RestShopifyClient({
      shop: 's.myshopify.com',
      accessToken: 't',
      fetchImpl: fetchImpl as never,
      sleep,
    });

    await client.productByHandle('a');
    expect(sleep).not.toHaveBeenCalled();
    await client.productByHandle('b');
    expect(sleep).toHaveBeenCalled();
  });

  it('honours Retry-After on a 429', async () => {
    const sleep = vi.fn(async () => {});
    let call = 0;
    const fetchImpl = vi.fn(async () =>
      call++ === 0
        ? new Response('slow', { status: 429, headers: { 'retry-after': '2' } })
        : response({ products: [] }),
    );
    await new RestShopifyClient({
      shop: 's.myshopify.com',
      accessToken: 't',
      fetchImpl: fetchImpl as never,
      sleep,
    }).productByHandle('a');

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('treats a missing asset as absent rather than as an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const asset = await new RestShopifyClient({
      shop: 's.myshopify.com',
      accessToken: 't',
      fetchImpl: fetchImpl as never,
    }).getAsset(1, ROBOTS_TEMPLATE_KEY);
    expect(asset).toBeNull();
  });

  it('refuses to construct without a shop or token', () => {
    expect(() => new RestShopifyClient({ shop: '', accessToken: 't' })).toThrow();
    expect(() => new RestShopifyClient({ shop: 's', accessToken: ' ' })).toThrow();
  });
});
