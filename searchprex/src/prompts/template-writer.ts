import type { PromptWriter, PromptWriterRequest } from './types.js';

/**
 * A writer with no model behind it.
 *
 * Composes prompts from templates, so the rest of the pipeline — validation,
 * deduplication, the caps, intent classification, the cost report — can be run
 * and reviewed without an API key or a network. Everything it produces is
 * obviously templated, which is the point: it demonstrates the machinery
 * without anyone mistaking the output for a real prompt set.
 *
 * It is not a fallback for the real writer. A caller that quietly used this
 * when a key was missing would ship a customer a set of filled-in templates.
 */
const TEMPLATES: Record<string, string[]> = {
  commercial: [
    'best budget {seed} under $50',
    'where to buy a {seed} online',
    'is a {seed} worth buying for the price',
  ],
  comparison: [
    'which {seed} is better for everyday use',
    '{seed} vs a mid range alternative',
  ],
  informational: [
    'how long does a {seed} last with daily use',
    'what should you look for in a {seed}',
  ],
  brand: ['is this shop a good place to buy a {seed}'],
};

export class TemplatePromptWriter implements PromptWriter {
  async write(request: PromptWriterRequest): Promise<string[]> {
    const seed = request.seed.text.toLowerCase().trim();
    const out: string[] = [];

    // Round-robin across the wanted intents so a small count still produces a
    // mix rather than three variations of the same question.
    const pools = request.intents.map((intent) => TEMPLATES[intent] ?? []);
    for (let round = 0; out.length < request.count; round += 1) {
      let addedThisRound = false;
      for (const pool of pools) {
        const template = pool[round];
        if (template === undefined) continue;
        out.push(template.replace('{seed}', seed));
        addedThisRound = true;
        if (out.length >= request.count) break;
      }
      if (!addedThisRound) break;
    }

    return out;
  }
}
