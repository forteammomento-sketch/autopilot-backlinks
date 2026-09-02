/**
 * Stable markers around everything this tool writes into a page.
 *
 * Every injected block is fenced by a comment pair carrying an id derived from
 * the block's question. That gives three things a deploy pipeline cannot work
 * without:
 *
 * 1. **Idempotency.** Re-deploying an updated block replaces the old one
 *    instead of appending a second copy. Without this, a customer who approves
 *    the same action twice ends up with duplicate passages on the page — the
 *    exact failure the whole product exists to avoid.
 * 2. **Rollback outside git.** The block can be removed by anyone with the
 *    page, not only by reverting our commit.
 * 3. **Attribution.** A developer reading the page can see what put it there.
 */

export const MARKER_PREFIX = 'searchprex';

export function blockId(question: string): string {
  return fnv1a(question.trim().toLowerCase());
}

export function openMarker(id: string): string {
  return `<!-- ${MARKER_PREFIX}:block:${id} -->`;
}

export function closeMarker(id: string): string {
  return `<!-- /${MARKER_PREFIX}:block:${id} -->`;
}

/** Replace the fenced region for `id`, or return null when it is not present. */
export function replaceMarked(source: string, id: string, replacement: string): string | null {
  const open = openMarker(id);
  const close = closeMarker(id);
  const start = source.indexOf(open);
  if (start === -1) return null;

  const end = source.indexOf(close, start);
  if (end === -1) return null;

  return source.slice(0, start) + replacement + source.slice(end + close.length);
}

export function wrap(id: string, html: string): string {
  return `${openMarker(id)}\n${html}\n${closeMarker(id)}`;
}

/** Ids of every block this tool has written into the page. */
export function markedIds(source: string): string[] {
  const pattern = new RegExp(`<!--\\s*${MARKER_PREFIX}:block:([0-9a-f]+)\\s*-->`, 'gi');
  return [...new Set([...source.matchAll(pattern)].map((m) => m[1]!))];
}

/** 32-bit FNV-1a, hex. Deterministic and short enough to read in a diff. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
