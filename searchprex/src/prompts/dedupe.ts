import { contentWords } from '../lib/html.js';
import { shingleContainment } from '../actions/answer-block.js';

/**
 * Two prompts that would produce the same measurement.
 *
 * "best budget barlow under $40" and "cheapest barlow knife under 40 dollars"
 * are one question asked twice. Both get measured across every engine three
 * times a week forever, so a duplicate is not untidy — it is a standing charge
 * for information already held.
 */

/** Order-independent key: the prompt's content words, sorted. */
export function canonicalKey(prompt: string): string {
  return contentWords(normalise(prompt)).sort().join(' ');
}

function normalise(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/\$\s*(\d+(?:\.\d+)?)/g, '$1 dollars')
    .replace(/\bcheapest\b/g, 'budget')
    .replace(/\baffordable\b/g, 'budget')
    .replace(/\bunder\b/g, 'below')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

export class PromptDeduper {
  #keys = new Set<string>();
  #texts: string[] = [];
  #threshold: number;

  constructor(existing: string[] = [], threshold = 0.8) {
    this.#threshold = threshold;
    for (const prompt of existing) this.add(prompt);
  }

  /** True when the prompt is new; adds it. False when it duplicates one held. */
  add(prompt: string): boolean {
    const key = canonicalKey(prompt);
    if (key === '' || this.#keys.has(key)) return false;

    for (const seen of this.#texts) {
      if (shingleContainment(normalise(prompt), normalise(seen), 2) >= this.#threshold) {
        return false;
      }
    }

    this.#keys.add(key);
    this.#texts.push(prompt);
    return true;
  }

  get size(): number {
    return this.#texts.length;
  }
}
