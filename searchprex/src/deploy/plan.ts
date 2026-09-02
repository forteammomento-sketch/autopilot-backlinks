import { applyAnswerBlock, applyCrawlFix, applySchema, type ApplyResult } from './apply.js';
import { blockId } from './markers.js';
import type { Action } from '../actions/types.js';
import type { DeployPlan, FileChange, PlanOptions, SkippedAction } from './types.js';

const DEPLOYABLE = new Set(['answer_block', 'schema', 'crawl_fix']);

/**
 * Turn approved actions into a set of file changes.
 *
 * Several actions can land on one page — an answer block and a schema block,
 * typically. Each is applied to the running content of that file rather than to
 * the original, so the second does not silently discard the first; `before`
 * still holds the untouched original, because that is what a rollback needs.
 *
 * Nothing here talks to GitHub. The plan is a pure function of the actions and
 * the current file contents, which is what makes it reviewable before anything
 * is pushed.
 */
export async function buildDeployPlan(
  actions: Action[],
  options: PlanOptions,
): Promise<DeployPlan> {
  const { maxBlocksPerRun = 5, robotsPath = 'robots.txt' } = options;

  const originals = new Map<string, string>();
  const working = new Map<string, string>();
  const applied = new Map<string, FileChange['applied']>();
  const skipped: SkippedAction[] = [];
  let blocksWritten = 0;
  let cappedCount = 0;

  // Highest priority first, so the cap drops the least valuable blocks.
  const ordered = [...actions].sort((a, b) => b.priority - a.priority);

  for (const action of ordered) {
    if (!DEPLOYABLE.has(action.actionType) || action.artifact === null) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason:
          action.actionType === 'rank_first'
            ? 'advisory — there is nothing to deploy'
            : 'no automated deploy for this action type yet; do it by hand',
      });
      continue;
    }

    const path = pathFor(action, options, robotsPath);
    if (path === null) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: 'could not map this URL to a file in the repository',
      });
      continue;
    }

    if (!working.has(path)) {
      const content = await options.readFile(path);
      if (content === null) {
        skipped.push({
          actionType: action.actionType,
          targetUrl: action.targetUrl,
          reason: `${path} does not exist in the repository`,
        });
        continue;
      }
      originals.set(path, content);
      working.set(path, content);
      applied.set(path, []);
    }

    if (action.actionType === 'answer_block') {
      if (blocksWritten >= maxBlocksPerRun) {
        cappedCount += 1;
        skipped.push({
          actionType: action.actionType,
          targetUrl: action.targetUrl,
          reason: `held back by the per-run cap of ${maxBlocksPerRun} blocks`,
        });
        continue;
      }
    }

    const result = applyOne(action, working.get(path)!);
    if (!result.changed) {
      skipped.push({
        actionType: action.actionType,
        targetUrl: action.targetUrl,
        reason: result.skipped ?? 'nothing to change',
      });
      continue;
    }

    working.set(path, result.content);
    applied.get(path)!.push({
      actionType: action.actionType,
      rationale: action.rationale,
      ...(action.artifact.kind === 'answer_block'
        ? { blockId: blockId(action.artifact.question) }
        : {}),
    });
    if (action.actionType === 'answer_block') blocksWritten += 1;
  }

  const changes: FileChange[] = [];
  for (const [path, after] of working) {
    const before = originals.get(path)!;
    if (after === before) continue;
    changes.push({ path, before, after, applied: applied.get(path)! });
  }

  return { changes, skipped, cappedCount };
}

function applyOne(action: Action, content: string): ApplyResult {
  switch (action.artifact?.kind) {
    case 'answer_block':
      return applyAnswerBlock(content, action.artifact);
    case 'schema':
      return applySchema(content, action.artifact);
    case 'crawl_fix':
      return applyCrawlFix(content, action.artifact);
    default:
      return { content, changed: false, skipped: 'unsupported artifact' };
  }
}

function pathFor(action: Action, options: PlanOptions, robotsPath: string): string | null {
  if (action.actionType === 'crawl_fix') return robotsPath;
  return action.targetUrl === null ? null : options.resolver(action.targetUrl);
}

/**
 * A default resolver for a static site whose URLs mirror its file tree.
 *
 * `/products/barlow` resolves to `products/barlow.html`, and `/` to
 * `index.html`. Any framework with its own routing needs its own resolver —
 * guessing wrong writes a block into the wrong file, so this returns null
 * rather than falling back to a best guess.
 */
export function staticSiteResolver(root = ''): (url: string) => string | null {
  const prefix = root === '' ? '' : `${root.replace(/\/+$/, '')}/`;

  return (url: string): string | null => {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }

    const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmed === '') return `${prefix}index.html`;
    if (/\.[a-z0-9]+$/i.test(trimmed)) return `${prefix}${trimmed}`;
    return `${prefix}${trimmed}.html`;
  };
}
