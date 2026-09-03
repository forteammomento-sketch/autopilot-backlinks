/**
 * A headless-browser renderer for `js_only` detection.
 *
 * Playwright is imported lazily so the app does not carry a browser dependency
 * unless someone actually wires this up — most deployments will not, and
 * `js_only` simply goes unreported rather than being guessed at.
 *
 * Three things are capped, because this runs against a customer's production
 * site once per candidate page in a crawl:
 *
 * - **Images, fonts, media and stylesheets are blocked.** Only the text matters
 *   and they are most of the bytes. It makes a render several times faster and
 *   takes real load off the customer's origin.
 * - **`domcontentloaded` plus a short settle**, not `networkidle`. A storefront
 *   with analytics beacons and chat widgets may never reach network idle, and
 *   waiting for it turns a two-second render into a timeout.
 * - **One browser, reused.** Launching Chromium per page would cost more than
 *   the crawl itself.
 */
export interface RendererOptions {
  timeoutMs?: number;
  /** Extra wait after DOM ready, for frameworks that hydrate late. Default 1200ms. */
  settleMs?: number;
  userAgent?: string;
}

const BLOCKED = new Set(['image', 'font', 'media', 'stylesheet']);

/**
 * The slice of Playwright's surface this file uses.
 *
 * Declared locally, and the module specifier below is a variable, so
 * TypeScript never tries to resolve `playwright` at build time. Playwright is
 * genuinely optional — a deployment that does not want `js_only` detection
 * should not have to install a browser to typecheck, and adding it as a
 * dependency purely to satisfy the compiler would make the optional thing
 * mandatory.
 */
interface RouteLike {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface PageLike {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ ok(): boolean } | null>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
}

interface ContextLike {
  route(pattern: string, handler: (route: RouteLike) => void): Promise<void>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface BrowserLike {
  newContext(options: { userAgent?: string }): Promise<ContextLike>;
  close(): Promise<void>;
}

interface ChromiumLike {
  launch(options: { executablePath?: string }): Promise<BrowserLike>;
}

export interface PageRenderer {
  render(url: string): Promise<string | null>;
  close(): Promise<void>;
}

export async function createPlaywrightRenderer(
  options: RendererOptions = {},
): Promise<PageRenderer> {
  const { timeoutMs = 20_000, settleMs = 1_200 } = options;

  // Lazily resolved: a deployment without Playwright installed should fail
  // here, with a message saying what to install, rather than at import time
  // taking the whole app down.
  const specifier = 'playwright';
  let chromium: ChromiumLike;
  try {
    ({ chromium } = (await import(specifier)) as { chromium: ChromiumLike });
  } catch {
    throw new Error(
      'js_only detection needs Playwright. Install it (`npm i -D playwright`) or leave ' +
        'the renderer unwired — the gap is then not reported rather than guessed at.',
    );
  }

  const browser = await chromium.launch({
    ...(process.env['PLAYWRIGHT_CHROMIUM_PATH'] === undefined
      ? {}
      : { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }),
  });

  const context = await browser.newContext({
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  });

  await context.route('**/*', (route: RouteLike) => {
    if (BLOCKED.has(route.request().resourceType())) {
      void route.abort();
      return;
    }
    void route.continue();
  });

  return {
    async render(url: string): Promise<string | null> {
      const page = await context.newPage();
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
        // A page that did not load is not a page that rendered nothing. Returning
        // null leaves renderedWords unset, so js_only stays unreported rather
        // than being inferred from a failed fetch.
        if (response === null || !response.ok()) return null;

        await page.waitForTimeout(settleMs);
        return await page.content();
      } catch {
        return null;
      } finally {
        await page.close();
      }
    },

    async close(): Promise<void> {
      await context.close();
      await browser.close();
    },
  };
}
