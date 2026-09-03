import { backoffMs } from '../engines/errors.js';

const DEFAULT_API_VERSION = '2025-01';

export interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
}

export interface ShopifyAsset {
  key: string;
  value: string;
}

/**
 * The Shopify operations a deploy needs, behind an interface so the pipeline is
 * testable without a store and so a GraphQL implementation can replace the REST
 * one later.
 */
export interface ShopifyClient {
  productByHandle(handle: string): Promise<ShopifyProduct | null>;
  updateProductBody(id: number, bodyHtml: string): Promise<void>;
  /** The published theme. Editing any other theme changes nothing customers see. */
  mainThemeId(): Promise<number | null>;
  getAsset(themeId: number, key: string): Promise<ShopifyAsset | null>;
  putAsset(themeId: number, key: string, value: string): Promise<void>;
}

export interface RestShopifyConfig {
  /** `your-store.myshopify.com`, not the customer-facing domain. */
  shop: string;
  /** Admin API access token, `shpat_...`. */
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Shopify Admin REST client.
 *
 * ## Rate limiting
 *
 * The REST Admin API runs a leaky bucket: forty requests of headroom refilling
 * at two a second on a standard plan. Every response reports the bucket in
 * `X-Shopify-Shop-Api-Call-Limit`, and this client slows down as it fills
 * rather than waiting to be told no. A deploy that trips the limit gets 429s
 * partway through a batch, which on a store means some products updated and
 * some not — the worst possible state to leave a catalogue in.
 */
export class RestShopifyClient implements ShopifyClient {
  #shop: string;
  #token: string;
  #version: string;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  /** Fraction of the bucket in use, from the last response. */
  #bucketUsed = 0;

  constructor(config: RestShopifyConfig) {
    if (config.shop.trim() === '') throw new Error('Shopify shop domain is empty');
    if (config.accessToken.trim() === '') throw new Error('Shopify access token is empty');

    this.#shop = config.shop.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.#token = config.accessToken;
    this.#version = config.apiVersion ?? DEFAULT_API_VERSION;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
    this.#sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async productByHandle(handle: string): Promise<ShopifyProduct | null> {
    const body = await this.#request<{ products?: unknown }>(
      'GET',
      `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle,title,body_html`,
    );

    const products = body.products;
    if (!Array.isArray(products) || products.length === 0) return null;

    const first = products[0] as Record<string, unknown>;
    return {
      id: Number(first['id']),
      handle: String(first['handle']),
      title: String(first['title'] ?? ''),
      bodyHtml: String(first['body_html'] ?? ''),
    };
  }

  async updateProductBody(id: number, bodyHtml: string): Promise<void> {
    await this.#request('PUT', `/products/${String(id)}.json`, {
      product: { id, body_html: bodyHtml },
    });
  }

  async mainThemeId(): Promise<number | null> {
    const body = await this.#request<{ themes?: unknown }>('GET', '/themes.json');
    if (!Array.isArray(body.themes)) return null;

    for (const theme of body.themes) {
      if (typeof theme !== 'object' || theme === null) continue;
      const record = theme as Record<string, unknown>;
      // `main` is the published theme. Writing to any other one is a change no
      // customer and no crawler will ever see.
      if (record['role'] === 'main') return Number(record['id']);
    }
    return null;
  }

  async getAsset(themeId: number, key: string): Promise<ShopifyAsset | null> {
    const body = await this.#request<{ asset?: unknown }>(
      'GET',
      `/themes/${String(themeId)}/assets.json?asset[key]=${encodeURIComponent(key)}`,
      undefined,
      [404],
    );

    const asset = body.asset;
    if (typeof asset !== 'object' || asset === null) return null;
    const record = asset as Record<string, unknown>;
    return { key: String(record['key']), value: String(record['value'] ?? '') };
  }

  async putAsset(themeId: number, key: string, value: string): Promise<void> {
    await this.#request('PUT', `/themes/${String(themeId)}/assets.json`, {
      asset: { key, value },
    });
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    tolerate: number[] = [],
  ): Promise<T> {
    // Slow down before the bucket fills rather than after: a 429 mid-batch
    // leaves some products updated and some not.
    if (this.#bucketUsed > 0.7) await this.#sleep(600);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await this.#fetch(
        `https://${this.#shop}/admin/api/${this.#version}${path}`,
        {
          method,
          headers: {
            'X-Shopify-Access-Token': this.#token,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );

      this.#readBucket(response.headers.get('x-shopify-shop-api-call-limit'));

      if (response.ok) return (await response.json()) as T;
      if (tolerate.includes(response.status)) return {} as T;

      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        await this.#sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
        continue;
      }

      const text = (await response.text().catch(() => '')).slice(0, 400);
      // The token is a header, so nothing here can carry it into a log.
      throw new Error(`Shopify ${method} ${path} failed: ${String(response.status)} ${text}`);
    }

    throw new Error(`Shopify ${method} ${path} failed after retries`);
  }

  #readBucket(header: string | null): void {
    if (header === null) return;
    const [used, total] = header.split('/').map(Number);
    if (used === undefined || total === undefined || !Number.isFinite(total) || total === 0) return;
    this.#bucketUsed = used / total;
  }
}

/** `https://shop.com/products/rough-rider-barlow` → `rough-rider-barlow`. */
export function handleFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  // Shopify serves the same product under /products/x and
  // /collections/y/products/x. Both are the same product.
  const match = /\/products\/([^/?#]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export { DEFAULT_API_VERSION };
