import type { Certainty, Gap, GapType } from '../gaps/types.js';

export type ActionType =
  | 'answer_block'
  | 'schema'
  | 'crawl_fix'
  | 'internal_link'
  | 'placement'
  | 'rank_first';

/** A first-party fact the generator is allowed to state as the brand's own. */
export interface Fact {
  /** What the fact is about, e.g. "blade steel". */
  claim: string;
  /** The specific value. Numbers, names, dates — this is what gets cited. */
  value: string;
  /** Extra terms that should make this fact match a prompt. */
  topic?: string[];
  /** Where it came from: a catalogue field, a policy page, a URL. */
  source: string;
}

export interface AnswerBlockArtifact {
  kind: 'answer_block';
  question: string;
  /** The self-contained answer, 40-90 words. */
  answer: string;
  /** Specifics beneath the answer, each traceable to a fact. */
  supporting: string[];
  /** Facts the copy draws on, by claim. */
  factsUsed: string[];
  html: string;
}

export interface SchemaArtifact {
  kind: 'schema';
  types: string[];
  jsonLd: Record<string, unknown>;
  html: string;
}

export interface CrawlFixArtifact {
  kind: 'crawl_fix';
  layer: 'robots' | 'edge';
  /** Lines to add to robots.txt, when the block is there. */
  robotsAdditions: string[];
  /** Human instruction for a block that is not in robots.txt. */
  note: string;
}

export interface InternalLinkArtifact {
  kind: 'internal_link';
  targetUrl: string;
  anchors: string[];
  /** Pages that should carry the new link, when the crawl supplied them. */
  sourceUrls: string[];
}

export interface PlacementArtifact {
  kind: 'placement';
  targets: { domain: string; citationCount: number }[];
  pitch: string | null;
}

export type ActionArtifact =
  | AnswerBlockArtifact
  | SchemaArtifact
  | CrawlFixArtifact
  | InternalLinkArtifact
  | PlacementArtifact;

export interface Action {
  /**
   * The stored action's id, when it came from a database. Deploy records point
   * back at it so a rollback knows which action to reopen.
   */
  id?: string;
  actionType: ActionType;
  gap: Gap;
  targetUrl: string | null;
  priority: number;
  certainty: Certainty;
  /** Null for `rank_first`, which is advisory and deliberately has no artifact. */
  artifact: ActionArtifact | null;
  /** Shown to the customer above the artifact. */
  rationale: string;
}

export type RefusalReason =
  | 'no_first_party_facts'
  | 'duplicate_of_existing'
  | 'validation_failed'
  | 'not_retrievable';

export interface Refusal {
  gap: Gap;
  actionType: ActionType;
  reason: RefusalReason;
  /** What would let this be generated. Shown to the customer verbatim. */
  needed: string;
}

export type GenerationOutcome =
  | { kind: 'action'; action: Action }
  | { kind: 'refused'; refusal: Refusal };

/** Which action a gap calls for. `null` means the gap produces no action. */
export const ACTION_FOR_GAP: Record<GapType, ActionType | null> = {
  bot_blocked: 'crawl_fix',
  js_only: 'crawl_fix',
  no_page: 'answer_block',
  weak_passage: 'answer_block',
  no_schema: 'schema',
  orphan: 'internal_link',
  rival_corroborated: 'placement',
  not_ranking: 'rank_first',
};
