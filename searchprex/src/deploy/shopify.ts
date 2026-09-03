import { applyAnswerBlock, applyCrawlFix } from './apply.js';
import { blockId } from './markers.js';
import { handleFromUrl, type ShopifyClient } from './shopify-client.js';
import type { Action, ActionType } from '../actions/types.js';
import type { SkippedAction } from './types.js';

export const ROBOTS_TEMPLATE_KEY = 'templates/robots.txt.liquid';

/**
 * Shopify's own robots.txt template.
 *
 * When a store has never customised robots.txt there is no asset to read — the
 * platform generates one. Writing a template containing only our allow group
 * would replace that generated file and **silently delete every default rule**,
 * exposing `/cart`, `/checkout`, `/account` and the search pages to crawlers
 * that Shopify had been keeping out. So a template created from scratch always
 * emits the defaults first.
 */
const DEFAULT_ROBOTS_TEMPLATE = `{% for group in robots.default_groups %}
{{- group.user_agent }}
{% for rule in group.rules %}{{ rule }}
{% endfor %}
{%- if group.sitemap %}{{ group.sitemap }}
{% endif %}
{% endfor %}`;

export type ShopifyChange =
  | {
      kind: 'product';
      productId: number;
      handle: string;
      before: string;
      after: string;
      applied: { actionId: string; actionType: ActionType; rationale: string }[];
    }
  | {
      kind: 'asset';
      themeId: number;
      key: string;
      before: string;
      after: string;
      applied: { actionId: string; actionType: ActionType; rationale: string }[];
    };

export interface ShopifyPlan {
  changes: ShopifyChange[];
  skipped: SkippedAction[];
  cappedCount: number;
}

export interface ShopifyPlanOptions {
  /** Answer blocks written per run. Default 5, as for the git target. */
  maxBlocksPerRun?: number;
}

/**
 * Turn approved actions into Shopify writes.
 *
 * Answer blocks go into the product's `body_html`. That is the product
 * description: server-rendered by every theme, the main content of the page,
 * and exactly what a crawler reads. A metafield would need a theme edit to
 * render at all, and a theme edit changes every product at once — a blast
 * radius no automated deploy should have.
 */
export async function buildShopifyPlan(
  actions: Action[],
  client: ShopifyClient,
  options: ShopifyPlanOptions = {},
): Promise<ShopifyPlan> {
  const { maxBlocksPerRun = 5 } = options;

  const skipped: SkippedAction[] = [];
  const products = new Map<string, Extract<ShopifyChange, { kind: 'product' }>>();
  let robotsChange: Extract<ShopifyChange, { kind: 'asset' }> | null = null;
  let blocksWritten = 0;
  let cappedCount = 0;

  for (const action of [...actions].sort((a, b) => b.priority - a.priority)) {
    if (action.artifact === null) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: 'advisory — there is nothing to deploy',
      });
      continue;
    }

    if (action.actionType === 'schema') {
      // Shopify themes already emit Product JSON-LD. Adding another block is
      // the same duplicate-type conflict the git target refuses: engines pick
      // one unpredictably, and the conflict would be ours.
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason:
          'the theme already emits Product schema — a second block is a conflict, not an ' +
          'improvement. Edit the theme by hand if the existing markup is wrong.',
      });
      continue;
    }

    if (action.actionType === 'crawl_fix') {
      const change = await planRobots(action, client, robotsChange);
      if (typeof change === 'string') {
        skipped.push({ actionType: action.actionType, targetUrl: action.targetUrl, reason: change });
        continue;
      }
      robotsChange = change;
      continue;
    }

    if (action.actionType !== 'answer_block' || action.artifact.kind !== 'answer_block') {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: 'no automated Shopify deploy for this action type yet; do it by hand',
      });
      continue;
    }

    if (blocksWritten >= maxBlocksPerRun) {
      cappedCount += 1;
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: `held back by the per-run cap of ${String(maxBlocksPerRun)} blocks`,
      });
      continue;
    }

    const handle = action.targetUrl === null ? null : handleFromUrl(action.targetUrl);
    if (handle === null) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: 'this URL is not a Shopify product page',
      });
      continue;
    }

    let entry = products.get(handle);
    if (entry === undefined) {
      const product = await client.productByHandle(handle);
      if (product === null) {
        skipped.push({
          actionType: action.actionType,
          targetUrl: action.targetUrl,
          reason: `no product with handle "${handle}" in this store`,
        });
        continue;
      }
      entry = {
        kind: 'product',
        productId: product.id,
        handle,
        before: product.bodyHtml,
        after: product.bodyHtml,
        applied: [],
      };
      products.set(handle, entry);
    }

    // `applyAnswerBlock` finds no <main> or <footer> in a description fragment
    // and appends, which is where a block belongs in a product description.
    // The marker still makes a second deploy replace rather than duplicate.
    const result = applyAnswerBlock(entry.after, action.artifact);
    if (!result.changed) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: result.skipped ?? 'nothing to change',
      });
      continue;
    }

    entry.after = result.content;
    entry.applied.push({
      actionId: idOf(action),
      actionType: action.actionType,
      rationale: action.rationale,
    });
    blocksWritten += 1;
  }

  const changes: ShopifyChange[] = [...products.values()].filter((c) => c.after !== c.before);
  if (robotsChange !== null && robotsChange.after !== robotsChange.before) {
    changes.push(robotsChange);
  }

  return { changes, skipped, cappedCount };
}

async function planRobots(
  action: Action,
  client: ShopifyClient,
  existing: Extract<ShopifyChange, { kind: 'asset' }> | null,
): Promise<Extract<ShopifyChange, { kind: 'asset' }> | string> {
  if (action.artifact?.kind !== 'crawl_fix') return 'not a crawl fix';
  if (action.artifact.layer === 'edge') {
    return (
      'this block is at the CDN, not in robots.txt. Shopify fronts stores with its own ' +
      'edge — raise it with Shopify support; nothing here can change it.'
    );
  }

  const themeId = await client.mainThemeId();
  if (themeId === null) return 'could not find the published theme';

  const asset = await client.getAsset(themeId, ROBOTS_TEMPLATE_KEY);
  // No asset means the store has never customised robots.txt and Shopify is
  // generating it. Starting from the defaults keeps every rule the platform
  // was already applying.
  const before = asset?.value ?? '';
  const base = before === '' ? DEFAULT_ROBOTS_TEMPLATE : before;

  const result = applyCrawlFix(base, action.artifact);
  if (!result.changed) return result.skipped ?? 'nothing to change in robots.txt';

  const merged = existing === null ? result.content : applyCrawlFix(existing.after, action.artifact).content;

  return {
    kind: 'asset',
    themeId,
    key: ROBOTS_TEMPLATE_KEY,
    before,
    after: existing === null ? result.content : merged,
    applied: [
      ...(existing?.applied ?? []),
      { actionId: idOf(action), actionType: action.actionType, rationale: action.rationale },
    ],
  };
}

export interface ShopifyDeployRecord {
  method: 'shopify';
  deployedAt: string;
  changes: {
    kind: 'product' | 'asset';
    /** Product id or asset key. */
    ref: string;
    /** Rollback payload: the exact content before the write. */
    before: string;
    actionIds: string[];
  }[];
}

/**
 * Apply a plan to the live store.
 *
 * **There is no pull request here, and no draft.** The git target's whole
 * safety story is that a person reads a diff before anything ships; Shopify has
 * no equivalent, so a write lands on the storefront the moment it succeeds. Two
 * things carry the weight instead: the plan is built and shown before this is
 * called, and every change records its previous content first, so the rollback
 * exists before the write does.
 *
 * Writes stop at the first failure. A half-applied catalogue is worse than a
 * partial one that says exactly where it stopped, and the records returned
 * cover only what actually landed.
 */
export async function applyShopifyPlan(
  plan: ShopifyPlan,
  client: ShopifyClient,
): Promise<ShopifyDeployRecord> {
  const record: ShopifyDeployRecord = {
    method: 'shopify',
    deployedAt: new Date().toISOString(),
    changes: [],
  };

  for (const change of plan.changes) {
    if (change.kind === 'product') {
      await client.updateProductBody(change.productId, change.after);
      record.changes.push({
        kind: 'product',
        ref: String(change.productId),
        before: change.before,
        actionIds: change.applied.map((a) => a.actionId),
      });
    } else {
      await client.putAsset(change.themeId, change.key, change.after);
      record.changes.push({
        kind: 'asset',
        ref: `${String(change.themeId)}:${change.key}`,
        before: change.before,
        actionIds: change.applied.map((a) => a.actionId),
      });
    }
  }

  return record;
}

/**
 * Put every changed record back to its pre-deploy content.
 *
 * A robots template that did not exist before the deploy is restored to
 * Shopify's defaults rather than to an empty file: writing an empty template
 * would leave the store with a robots.txt that allows everything, which is a
 * worse state than the one being undone.
 */
export async function rollbackShopifyDeploy(
  record: ShopifyDeployRecord,
  client: ShopifyClient,
): Promise<void> {
  for (const change of record.changes) {
    if (change.kind === 'product') {
      await client.updateProductBody(Number(change.ref), change.before);
      continue;
    }

    const [themeId, ...keyParts] = change.ref.split(':');
    await client.putAsset(
      Number(themeId),
      keyParts.join(':'),
      change.before === '' ? DEFAULT_ROBOTS_TEMPLATE : change.before,
    );
  }
}

/**
 * The stored id when there is one, otherwise a stable hash of what the action
 * targets. The hash keeps the fixture and CLI paths working; a deploy that has
 * to be rolled back in a database always has the real id.
 */
function idOf(action: Action): string {
  if (action.id !== undefined && action.id !== '') return action.id;
  return action.targetUrl === null
    ? blockId(`${action.actionType}:${action.gap.prompt}`)
    : blockId(`${action.actionType}:${action.targetUrl}:${action.gap.prompt}`);
}

export { DEFAULT_ROBOTS_TEMPLATE };
