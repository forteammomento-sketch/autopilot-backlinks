import { extractJsonLd, schemaTypes } from '../lib/html.js';
import { parseRobots } from '../lib/robots.js';
import type {
  AnswerBlockArtifact,
  CrawlFixArtifact,
  SchemaArtifact,
} from '../actions/types.js';
import { blockId, replaceMarked, wrap } from './markers.js';

export interface ApplyResult {
  content: string;
  changed: boolean;
  /** Why nothing changed, when `changed` is false. Shown to the customer. */
  skipped?: string;
}

/**
 * Insert or update an answer block in a page.
 *
 * Placement is deterministic and tried in order: an existing marked block, then
 * before `</main>`, then before the footer, then before `</body>`. The point of
 * the ordering is to land inside the page's main content region — a block
 * appended after the footer is in the DOM but outside the region most
 * extractors treat as the page body, which wastes the whole action.
 */
export function applyAnswerBlock(html: string, artifact: AnswerBlockArtifact): ApplyResult {
  const id = blockId(artifact.question);
  const block = wrap(id, artifact.html);

  const replaced = replaceMarked(html, id, block);
  if (replaced !== null) {
    return replaced === html
      ? { content: html, changed: false, skipped: 'the block is already present and unchanged' }
      : { content: replaced, changed: true };
  }

  for (const anchor of ['</main>', '<footer', '</body>']) {
    const at = anchor.startsWith('</')
      ? html.lastIndexOf(anchor)
      : html.indexOf(anchor);
    if (at === -1) continue;
    return { content: `${html.slice(0, at)}${block}\n${html.slice(at)}`, changed: true };
  }

  return { content: `${html}\n${block}`, changed: true };
}

/**
 * Add a JSON-LD block to a page's head.
 *
 * If the page already carries markup of the same `@type`, nothing is written.
 * Two competing Product blocks on one page is worse than none: search engines
 * pick one unpredictably, and the customer now has a structured-data conflict
 * we created.
 */
export function applySchema(html: string, artifact: SchemaArtifact): ApplyResult {
  const existing = new Set(schemaTypes(html).map((t) => t.toLowerCase()));
  const conflicting = artifact.types.filter((t) => existing.has(t.toLowerCase()));

  if (conflicting.length > 0) {
    return {
      content: html,
      changed: false,
      skipped:
        `the page already has ${conflicting.join(', ')} markup. Two competing blocks of ` +
        'the same type is worse than one — merge by hand if the existing block is wrong.',
    };
  }

  const id = blockId(`schema:${artifact.types.join(',')}`);
  const block = wrap(id, artifact.html);

  const replaced = replaceMarked(html, id, block);
  if (replaced !== null) return { content: replaced, changed: replaced !== html };

  const headClose = html.toLowerCase().lastIndexOf('</head>');
  if (headClose !== -1) {
    return { content: `${html.slice(0, headClose)}${block}\n${html.slice(headClose)}`, changed: true };
  }

  // No head: JSON-LD is valid in the body too.
  return { content: `${block}\n${html}`, changed: true };
}

/**
 * Add an allow group to robots.txt.
 *
 * When a group for the agent already exists, nothing is written and the caller
 * is told to edit it by hand. Rewriting a group somebody deliberately
 * configured — possibly for legal or bandwidth reasons we know nothing about —
 * is not a change a tool should make unattended.
 */
export function applyCrawlFix(robotsTxt: string, artifact: CrawlFixArtifact): ApplyResult {
  if (artifact.layer !== 'robots' || artifact.robotsAdditions.length === 0) {
    return {
      content: robotsTxt,
      changed: false,
      skipped: 'this block is not in robots.txt — it needs a change at the edge or in the app',
    };
  }

  const agents = artifact.robotsAdditions
    .filter((line) => /^user-agent:/i.test(line))
    .map((line) => line.split(':')[1]!.trim().toLowerCase());

  const parsed = parseRobots(robotsTxt);
  const alreadyNamed = agents.filter((agent) =>
    parsed.groups.some((group) => group.userAgents.includes(agent)),
  );

  if (alreadyNamed.length > 0) {
    return {
      content: robotsTxt,
      changed: false,
      skipped:
        `robots.txt already has a group for ${alreadyNamed.join(', ')}. Edit it by hand — ` +
        'that group was configured deliberately and may exist for reasons this tool ' +
        'cannot see.',
    };
  }

  const separator = robotsTxt.endsWith('\n') ? '' : '\n';
  const addition = artifact.robotsAdditions.join('\n').replace(/\n+$/, '');
  return {
    content: `${robotsTxt}${separator}\n# Added by Searchprex: allow AI answer engines to retrieve pages\n${addition}\n`,
    changed: true,
  };
}

/** Remove a marked block. Used by rollback and by "undo" in the UI. */
export function removeBlock(content: string, id: string): ApplyResult {
  const stripped = replaceMarked(content, id, '');
  if (stripped === null) {
    return { content, changed: false, skipped: 'no block with that id is present' };
  }
  return { content: stripped.replace(/\n{3,}/g, '\n\n'), changed: true };
}

/** True when the page carries JSON-LD that fails to parse. */
export function hasBrokenJsonLd(html: string): boolean {
  const blocks = html.match(/<script\b[^>]*application\/ld\+json[^>]*>/gi)?.length ?? 0;
  return blocks > extractJsonLd(html).length;
}
