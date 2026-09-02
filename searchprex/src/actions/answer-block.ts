import { contentWords } from '../lib/html.js';
import { ANSWER_MAX_WORDS, ANSWER_MIN_WORDS, wordCount } from '../lib/html.js';
import type { AnswerBlockArtifact, Fact, RefusalReason } from './types.js';

export interface AnswerBlockRequest {
  prompt: string;
  /** Only facts already filtered for relevance reach the writer. */
  facts: Fact[];
  /** The passage the engine cited instead, when we have it. */
  rivalPassage: string | null;
  /** What the page says now, for a rewrite rather than a bolt-on. */
  existingPassage: string | null;
  brandName: string;
}

export interface AnswerBlockDraft {
  answer: string;
  supporting: string[];
}

/**
 * The model-backed half of the engine. Kept behind an interface so the package
 * stays provider-agnostic and so every rule below can be tested without a
 * network call.
 */
export interface AnswerBlockWriter {
  write(request: AnswerBlockRequest): Promise<AnswerBlockDraft>;
}

export type ValidationFailure =
  | 'too_short'
  | 'too_long'
  | 'no_fact_used'
  | 'restates_rival'
  | 'duplicate';

export interface AnswerBlockOptions {
  /** Blocks already deployed for this project, for the duplicate check. */
  existingBlocks?: string[];
  /**
   * Similarity in 0-1. Defaults to shingle containment; the app should pass a
   * pgvector-backed cosine instead once embeddings are available.
   */
  similarity?: (a: string, b: string) => number;
  duplicateThreshold?: number;
  /** Attempts before refusing. Default 2. */
  maxAttempts?: number;
}

export type AnswerBlockResult =
  | { ok: true; artifact: AnswerBlockArtifact }
  | { ok: false; reason: RefusalReason; needed: string; failures: ValidationFailure[] };

/**
 * Facts that bear on the prompt.
 *
 * Relevance is matched on what the fact is *about* — its claim and topic — not
 * on its value. A price of "$39" shares no words with any question, but it is
 * exactly the kind of specific an answer needs.
 */
export function relevantFacts(prompt: string, facts: Fact[]): Fact[] {
  const terms = new Set(contentWords(prompt));
  if (terms.size === 0) return [];

  return facts.filter((fact) => {
    const about = contentWords(`${fact.claim} ${(fact.topic ?? []).join(' ')}`);
    return about.some((word) => terms.has(word));
  });
}

/**
 * Generate a validated answer block, or refuse.
 *
 * **Refusal is a first-class output.** With no first-party facts to work from,
 * a generated block can only restate what the rival page already says — which
 * adds a near-duplicate passage to a site that, in the case this product was
 * built for, already has a duplication problem. Producing nothing is the
 * correct result, and the caller surfaces `needed` so the customer knows what
 * would unblock it.
 */
export async function generateAnswerBlock(
  request: AnswerBlockRequest,
  writer: AnswerBlockWriter,
  options: AnswerBlockOptions = {},
): Promise<AnswerBlockResult> {
  const {
    existingBlocks = [],
    similarity = shingleContainment,
    duplicateThreshold = 0.7,
    maxAttempts = 2,
  } = options;

  const usable = relevantFacts(request.prompt, request.facts);
  if (usable.length === 0) {
    return {
      ok: false,
      reason: 'no_first_party_facts',
      needed:
        'A first-party fact about this topic — a spec, a measurement, a policy, a ' +
        'price, something only this business can state. Without one, any block ' +
        'generated here would restate the competitor page that is already cited.',
      failures: [],
    };
  }

  let lastFailures: ValidationFailure[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = await writer.write({ ...request, facts: usable });
    const failures = validate(draft, usable, request.rivalPassage, existingBlocks, {
      similarity,
      duplicateThreshold,
    });

    if (failures.length === 0) {
      return { ok: true, artifact: toArtifact(request, draft, usable) };
    }
    lastFailures = failures;
  }

  const duplicate = lastFailures.includes('duplicate') || lastFailures.includes('restates_rival');
  return {
    ok: false,
    reason: duplicate ? 'duplicate_of_existing' : 'validation_failed',
    needed: describeFailures(lastFailures),
    failures: lastFailures,
  };
}

function validate(
  draft: AnswerBlockDraft,
  facts: Fact[],
  rivalPassage: string | null,
  existingBlocks: string[],
  options: { similarity: (a: string, b: string) => number; duplicateThreshold: number },
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const words = wordCount(draft.answer);

  if (words < ANSWER_MIN_WORDS) failures.push('too_short');
  if (words > ANSWER_MAX_WORDS) failures.push('too_long');

  // The whole point of requiring facts is that they appear in the output.
  const combined = `${draft.answer} ${draft.supporting.join(' ')}`.toLowerCase();
  const used = facts.filter((fact) => combined.includes(fact.value.toLowerCase().trim()));
  if (used.length === 0) failures.push('no_fact_used');

  if (rivalPassage !== null && options.similarity(draft.answer, rivalPassage) >= options.duplicateThreshold) {
    failures.push('restates_rival');
  }

  for (const existing of existingBlocks) {
    if (options.similarity(draft.answer, existing) >= options.duplicateThreshold) {
      failures.push('duplicate');
      break;
    }
  }

  return failures;
}

function toArtifact(
  request: AnswerBlockRequest,
  draft: AnswerBlockDraft,
  facts: Fact[],
): AnswerBlockArtifact {
  const combined = `${draft.answer} ${draft.supporting.join(' ')}`.toLowerCase();
  const factsUsed = facts
    .filter((fact) => combined.includes(fact.value.toLowerCase().trim()))
    .map((fact) => fact.claim);

  const question = toQuestion(request.prompt);
  const supportingHtml =
    draft.supporting.length === 0
      ? ''
      : `\n  <ul>\n${draft.supporting.map((s) => `    <li>${escapeHtml(s)}</li>`).join('\n')}\n  </ul>`;

  return {
    kind: 'answer_block',
    question,
    answer: draft.answer,
    supporting: draft.supporting,
    factsUsed,
    html:
      `<section class="sp-answer">\n` +
      `  <h2>${escapeHtml(question)}</h2>\n` +
      `  <p>${escapeHtml(draft.answer)}</p>${supportingHtml}\n` +
      `</section>`,
  };
}

function toQuestion(prompt: string): string {
  const trimmed = prompt.trim().replace(/\?+$/, '');
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${capitalised}?`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function describeFailures(failures: ValidationFailure[]): string {
  const messages: Record<ValidationFailure, string> = {
    too_short: `an answer of at least ${ANSWER_MIN_WORDS} words`,
    too_long: `an answer of at most ${ANSWER_MAX_WORDS} words`,
    no_fact_used: 'an answer that states at least one of the supplied first-party facts',
    restates_rival: 'an answer that says something the already-cited competitor page does not',
    duplicate: 'an answer that differs from the blocks already deployed on this site',
  };
  return `The writer could not produce ${[...new Set(failures)].map((f) => messages[f]).join('; ')}.`;
}

/**
 * Shingle containment, 0-1: how much of the shorter text appears in the longer.
 *
 * Deliberately not Jaccard. Jaccard divides by the union, so it falls as the
 * texts diverge in length — a block that reproduces the rival passage verbatim
 * and pads it with one extra sentence scores around 0.5 and sails through.
 * That padded copy is precisely the failure this check exists to catch.
 * Containment divides by the shorter side, so full reuse scores 1 no matter
 * how much filler is wrapped around it.
 *
 * A stand-in for embedding cosine: deterministic, free, and it catches
 * near-verbatim reuse. It will not catch a paraphrase that shares no wording —
 * pass a real embedding similarity through `options.similarity` once pgvector
 * is wired.
 */
export function shingleContainment(a: string, b: string, size = 3): number {
  const left = shingles(a, size);
  const right = shingles(b, size);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const shingle of left) if (right.has(shingle)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function shingles(text: string, size: number): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const out = new Set<string>();
  if (tokens.length === 0) return out;
  if (tokens.length < size) {
    out.add(tokens.join(' '));
    return out;
  }
  for (let i = 0; i <= tokens.length - size; i += 1) {
    out.add(tokens.slice(i, i + size).join(' '));
  }
  return out;
}
