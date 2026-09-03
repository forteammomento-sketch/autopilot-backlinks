/**
 * HTML inspection for gap detection.
 *
 * Regex-based on purpose: this runs against the raw HTML the crawler receives,
 * over thousands of pages, and never needs a DOM. It is not a parser and must
 * not be used where correctness on adversarial markup matters — swap in a real
 * parser if this ever drives a deploy rather than a diagnosis.
 */

const BLOCK_TAGS = 'p|div|section|article|li|h[1-6]|br|tr|td|blockquote';

/** Visible text, with script/style/template contents removed. */
export function visibleText(html: string): string {
  // A sentinel marks real block boundaries before whitespace is collapsed.
  // Newlines in the HTML source are formatting, not structure: a paragraph
  // wrapped across three source lines is still one paragraph, and splitting on
  // those newlines would chop every real answer into fragments too short to
  // pass the answer-length band.
  const BOUNDARY = '\u0000';

  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), BOUNDARY)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/\s+/g, ' ')
    .split(BOUNDARY)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .join('\n');
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Every JSON-LD block that parses. Malformed blocks are skipped, not thrown. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const body = match[1];
    if (body === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(body.trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // A block that does not parse is a block search engines also ignore.
    }
  }
  return out;
}

/** `@type` values present anywhere in the page's JSON-LD, including @graph. */
export function schemaTypes(html: string): string[] {
  const types = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;

    const type = record['@type'];
    if (typeof type === 'string') types.add(type);
    else if (Array.isArray(type)) {
      for (const t of type) if (typeof t === 'string') types.add(t);
    }

    const graph = record['@graph'];
    if (graph !== undefined) walk(graph);
  };

  extractJsonLd(html).forEach(walk);
  return [...types].sort();
}

export function hasSchemaType(html: string, wanted: string[]): boolean {
  const present = new Set(schemaTypes(html).map((t) => t.toLowerCase()));
  return wanted.some((t) => present.has(t.toLowerCase()));
}

/**
 * Whether the page tells search engines not to show a snippet.
 *
 * This matters more than it looks: `nosnippet` and `max-snippet:0` are the only
 * controls that keep a page out of AI Overviews, and sites set them years ago
 * for reasons nobody remembers. A page carrying one cannot be cited there no
 * matter what content is added.
 */
export function hasSnippetSuppression(html: string): boolean {
  const metas = html.matchAll(/<meta\b[^>]*>/gi);
  for (const match of metas) {
    const tag = match[0];
    if (!/name\s*=\s*["']?(?:robots|googlebot)["']?/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (/\bnosnippet\b/i.test(content)) return true;
    if (/\bmax-snippet\s*:\s*0\b/i.test(content)) return true;
  }
  return false;
}

export interface Passage {
  text: string;
  words: number;
  /** Share of the prompt's content words that appear in the passage, 0-1. */
  overlap: number;
  /** Whether the passage length falls inside the answerable band. */
  inBand: boolean;
}

/** Shorter reads as a fragment, longer as a wall of text. */
export const ANSWER_MIN_WORDS = 25;
export const ANSWER_MAX_WORDS = 90;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'what',
  'which', 'who', 'how', 'why', 'when', 'where', 'best', 'good', 'with',
  'from', 'by', 'as', 'that', 'this', 'it', 'its', 'you', 'your',
]);

export function contentWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  ];
}

/**
 * The page's best candidate answer passage for a prompt.
 *
 * Engines extract at passage level, so what matters is not whether the page
 * covers the topic somewhere across 2,000 words but whether one block of
 * 25-90 words answers the question on its own. Paragraphs outside that band
 * are still scored — a page whose only relevant text is a 300-word wall is a
 * `weak_passage` gap, and the detector needs to see the wall to say so.
 */
export function bestPassage(html: string, prompt: string): Passage | null {
  const terms = contentWords(prompt);
  if (terms.length === 0) return null;

  const paragraphs = visibleText(html)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 8);

  let bestInBand: Passage | null = null;
  let bestOverall: Passage | null = null;

  for (const paragraph of paragraphs) {
    const words = contentWords(paragraph);
    const present = terms.filter((t) => words.includes(t)).length;
    const count = wordCount(paragraph);
    const passage: Passage = {
      text: paragraph,
      words: count,
      overlap: present / terms.length,
      inBand: count >= ANSWER_MIN_WORDS && count <= ANSWER_MAX_WORDS,
    };

    if (bestOverall === null || passage.overlap > bestOverall.overlap) bestOverall = passage;
    if (passage.inBand && (bestInBand === null || passage.overlap > bestInBand.overlap)) {
      bestInBand = passage;
    }
  }

  // An in-band passage always wins, even against a better-matching heading.
  // A heading that restates the question scores perfectly on overlap but
  // answers nothing, and treating it as the page's answer would mark every
  // well-structured FAQ page as thin.
  return bestInBand ?? bestOverall;
}
