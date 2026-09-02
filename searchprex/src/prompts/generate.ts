import { classifyIntent, namesBrand } from './intent.js';
import { PromptDeduper } from './dedupe.js';
import type {
  GeneratedPrompt,
  PromptGenerateOptions,
  GenerationReport,
  PromptIntent,
  PromptSeed,
  PromptWriter,
  RejectedPrompt,
  RejectionReason,
} from './types.js';

/** Below this it is a keyword, above it nobody types it. */
const MIN_WORDS = 4;
const MAX_WORDS = 15;

const DEFAULT_INTENTS: PromptIntent[] = ['commercial', 'comparison', 'informational'];

/** A prompt with none of these reads as a bare noun phrase, not a question. */
const SIGNAL =
  /\b(?:how|what|which|why|when|where|who|is|are|does|do|can|should|best|top|cheapest|budget|vs\.?|versus|buy|worth|compare|difference)\b/i;

export interface PromptGenerateContext {
  topic: string;
  brandAliases: string[];
  /**
   * Allow prompts that name the brand. Default false, and the default is the
   * point: a prompt naming the store is one the store is nearly guaranteed to
   * win, so it measures brand recall rather than discovery. Paying to measure
   * it every week buys a number that only ever goes up.
   */
  allowBrandPrompts?: boolean;
}

export async function generatePrompts(
  seeds: PromptSeed[],
  context: PromptGenerateContext,
  writer: PromptWriter,
  options: PromptGenerateOptions = {},
): Promise<GenerationReport> {
  const {
    maxTotal = 60,
    maxPerCluster = 6,
    perSeed = 4,
    intents = DEFAULT_INTENTS,
    existing = [],
    duplicateThreshold = 0.8,
  } = options;

  const deduper = new PromptDeduper(existing, duplicateThreshold);
  const rejected: RejectedPrompt[] = [];
  const candidates: GeneratedPrompt[] = [];
  const perCluster = new Map<string, number>();

  for (const seed of seeds) {
    if (candidates.length >= maxTotal * 2) break;

    const drafts = await writer.write({ seed, topic: context.topic, intents, count: perSeed });

    for (const draft of drafts) {
      const text = draft.trim().replace(/\s+/g, ' ');
      const reason = validate(text, context);

      if (reason !== null) {
        rejected.push({ text, reason, cluster: seed.cluster });
        continue;
      }
      if (!deduper.add(text)) {
        rejected.push({ text, reason: 'duplicate', cluster: seed.cluster });
        continue;
      }

      const used = perCluster.get(seed.cluster) ?? 0;
      if (used >= maxPerCluster) {
        rejected.push({ text, reason: 'over_cluster_cap', cluster: seed.cluster });
        continue;
      }
      perCluster.set(seed.cluster, used + 1);

      candidates.push({
        text,
        intent: classifyIntent(text, context.brandAliases),
        cluster: seed.cluster,
        seed: seed.text,
      });
    }
  }

  // When the total cap bites, keep the intents the ranker values most. Cutting
  // at random would spend the budget on informational prompts whose wins nobody
  // buys after.
  const order = new Map(intents.map((intent, i) => [intent, i]));
  const sorted = [...candidates].sort(
    (a, b) => (order.get(a.intent) ?? 99) - (order.get(b.intent) ?? 99),
  );

  const kept = sorted.slice(0, maxTotal);
  for (const dropped of sorted.slice(maxTotal)) {
    rejected.push({ text: dropped.text, reason: 'over_total_cap', cluster: dropped.cluster });
  }

  return {
    prompts: kept,
    rejected,
    weeklyCallsPerEngine: kept.length * 3,
  };
}

function validate(text: string, context: PromptGenerateContext): RejectionReason | null {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) return 'too_short';
  if (words > MAX_WORDS) return 'too_long';
  if (!SIGNAL.test(text)) return 'not_a_question';
  if (context.allowBrandPrompts !== true && namesBrand(text, context.brandAliases)) {
    return 'names_the_brand';
  }
  return null;
}

/** Per-engine weekly cost of a prompt set, for the caller to sanity-check. */
export function weeklyCost(promptCount: number, engineCount: number, repeats = 3): number {
  return promptCount * engineCount * repeats;
}
