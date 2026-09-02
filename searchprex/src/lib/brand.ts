/**
 * Brand mention detection inside an engine's answer text.
 *
 * "Mentioned" and "cited" are different things and the product depends on the
 * difference: an answer can name a brand without linking it (mentioned, not
 * cited) or link a page without naming the brand in prose (cited, not
 * mentioned). Only the second earns referral traffic; the first still moves
 * purchase intent. Both are recorded separately.
 */

export interface BrandMatch {
  mentioned: boolean;
  /** Character offset of the first match in the answer text. */
  firstOffset: number | null;
  /** Which alias matched first — useful when a brand has a nickname. */
  matchedAlias: string | null;
}

/**
 * Aliases are matched whole, not as substrings. `Fox` must not match
 * `Foxtrot`, and `SMK` must not match `SMKT`. Unicode letter/number lookaround
 * is used instead of `\b` so that a trailing apostrophe ("SMK Store's range")
 * and accented names both behave.
 */
function aliasPattern(aliases: string[]): RegExp | null {
  const usable = aliases
    .map((alias) => alias.trim())
    .filter((alias) => alias !== '')
    // Sort longest-first so "SMK Store" wins over "SMK" and reports the more
    // specific alias as the match.
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);

  if (usable.length === 0) return null;

  // Internal whitespace in an alias should tolerate any run of whitespace.
  const alternation = usable.map((a) => a.replace(/\\?\s+/g, '\\s+')).join('|');
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`,
    'iu',
  );
}

export function findBrandMention(answerText: string, aliases: string[]): BrandMatch {
  const pattern = aliasPattern(aliases);
  if (pattern === null || answerText === '') {
    return { mentioned: false, firstOffset: null, matchedAlias: null };
  }

  const match = pattern.exec(answerText);
  if (match === null) {
    return { mentioned: false, firstOffset: null, matchedAlias: null };
  }

  return {
    mentioned: true,
    firstOffset: match.index,
    matchedAlias: match[0],
  };
}

/**
 * Aliases to match a project against, derived from its configured brand names
 * plus the bare domain label. A customer who enters only `smkstore.com` should
 * still match the answer text "SMK Store", so the domain label is included both
 * as-is and de-camelised.
 */
export function aliasesForProject(domain: string, brandNames: string[]): string[] {
  const label = domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    ?.split('.')[0];

  const derived = label === undefined || label === '' ? [] : [label];
  return [...new Set([...brandNames, ...derived].filter((s) => s.trim() !== ''))];
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
