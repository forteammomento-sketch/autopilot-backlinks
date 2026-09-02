export type PromptIntent = 'informational' | 'comparison' | 'commercial' | 'brand';

export interface GeneratedPrompt {
  text: string;
  intent: PromptIntent;
  cluster: string;
  /** What the prompt was generated from, so a bad prompt is traceable. */
  seed: string;
}

export type RejectionReason =
  | 'too_short'
  | 'too_long'
  | 'names_the_brand'
  | 'duplicate'
  | 'not_a_question'
  | 'over_cluster_cap'
  | 'over_total_cap';

export interface RejectedPrompt {
  text: string;
  reason: RejectionReason;
  cluster: string;
}

/**
 * Something real to generate prompts about.
 *
 * Seeds come from the customer's own catalogue and their Search Console
 * queries, never from the topic alone. A prompt set imagined from "knives and
 * outdoor gear" will ask about products they do not stock, and every one of
 * those is a paid measurement of a question they could never win.
 */
export interface PromptSeed {
  /** A product, category or query the site actually has. */
  text: string;
  /** Groups prompts so one category cannot eat the whole budget. */
  cluster: string;
  /** Impressions from Search Console, when the seed came from there. */
  impressions?: number;
}

export interface PromptWriterRequest {
  seed: PromptSeed;
  topic: string;
  /** Intents wanted for this seed, in priority order. */
  intents: PromptIntent[];
  count: number;
}

/** The model-backed half. Behind an interface so every rule below is testable. */
export interface PromptWriter {
  write(request: PromptWriterRequest): Promise<string[]>;
}

export interface PromptGenerateOptions {
  /**
   * Total prompts. Default 60.
   *
   * This is the single biggest cost lever in the product: every prompt is
   * measured across every engine, three times, every week. Sixty prompts on two
   * engines is 360 calls a run; two hundred is 1,200. A bigger set does not make
   * the loop better, it makes it more expensive.
   */
  maxTotal?: number;
  /** Prompts per cluster. Default 6, so no one category dominates. */
  maxPerCluster?: number;
  /** Prompts asked of the writer per seed. Default 4. */
  perSeed?: number;
  /**
   * Target intent mix. Commercial and comparison prompts are weighted highest
   * in the action ranker, so the set should lean that way — an informational
   * win is a citation nobody buys after.
   */
  intents?: PromptIntent[];
  /** Existing prompts, so a re-run adds rather than duplicates. */
  existing?: string[];
  /** Near-duplicate threshold, 0-1. Default 0.8. */
  duplicateThreshold?: number;
}

export interface GenerationReport {
  prompts: GeneratedPrompt[];
  rejected: RejectedPrompt[];
  /** Engine calls a weekly run of this set would cost, per engine. */
  weeklyCallsPerEngine: number;
}
