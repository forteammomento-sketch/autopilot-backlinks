import type { PromptIntent } from './types.js';

/**
 * Classify a prompt's intent.
 *
 * Deterministic on purpose. "best", "vs" and "where to buy" are unambiguous
 * markers, and asking a model to label them would add a call, a cost and a
 * source of drift to a decision that regex gets right — while the ranker reads
 * this label to decide what a win is worth.
 */
const COMPARISON_MARKER =
  /\b(?:vs\.?|versus|compared? (?:to|with)|difference between|better than|instead of)\b/i;
// "which hunting knife is better for deer" is a comparison the buyer is running,
// even though the words "which is better" never appear adjacent. A bare `or` is
// deliberately not a marker — "best knife for camping or hiking" is one question.
const COMPARISON_QUESTION = /\b(?:which|what)\b[^?]{0,60}\b(?:better|best of|beats)\b/i;

const COMPARISON = {
  test: (value: string): boolean =>
    COMPARISON_MARKER.test(value) || COMPARISON_QUESTION.test(value),
};
const COMMERCIAL =
  /\b(?:best|top|cheapest|affordable|budget|where (?:to|can i) buy|buy|for sale|deal|price|under\s*\$?\d|worth (?:it|buying))\b/i;

export function classifyIntent(prompt: string, brandAliases: string[] = []): PromptIntent {
  if (namesBrand(prompt, brandAliases)) return 'brand';
  // Comparison wins over commercial: "best X vs Y" is a comparison the buyer is
  // running, and it is worth more than a generic "best X" listicle query.
  if (COMPARISON.test(prompt)) return 'comparison';
  if (COMMERCIAL.test(prompt)) return 'commercial';
  return 'informational';
}

export function namesBrand(prompt: string, aliases: string[]): boolean {
  const usable = aliases.map((a) => a.trim()).filter((a) => a !== '');
  if (usable.length === 0) return false;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${usable
      .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
      .join('|')})(?![\\p{L}\\p{N}])`,
    'iu',
  );
  return pattern.test(prompt);
}
