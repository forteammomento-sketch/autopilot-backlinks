import type { DetectionResult, Gap } from '../gaps/types.js';
import { buildCrawlFix, buildInternalLink, buildPlacement, buildSchema, type LinkSource } from './artifacts.js';
import {
  generateAnswerBlock,
  type AnswerBlockOptions,
  type AnswerBlockWriter,
} from './answer-block.js';
import { priorityFor } from './rank.js';
import {
  ACTION_FOR_GAP,
  type Action,
  type ActionType,
  type Fact,
  type GenerationOutcome,
} from './types.js';

export interface GenerateOptions extends AnswerBlockOptions {
  brandName: string;
  /** The fact sheet the answer-block generator is allowed to draw on. */
  facts: Fact[];
  writer: AnswerBlockWriter;
  /** Optional drafter for outreach pitches; without it, placements carry targets only. */
  pitchWriter?: (gap: Gap) => Promise<string | null>;
  /** Well-linked pages that could carry a new internal link. */
  linkSources?: LinkSource[];
  /** Intent per prompt text, from the prompt universe. */
  intents?: Record<string, string>;
  /** Share of the customer's AI traffic per engine, 0-1. */
  engineWeights?: Record<string, number>;
  /** Observed win rate per action type, from lift_measurements. */
  winRates?: Partial<Record<ActionType, number>>;
  /** Page HTML by URL, for schema generation. */
  pageHtml?: Record<string, string>;
}

/**
 * Turn detected gaps into actions.
 *
 * The rule that shapes everything here: **an answer block is only generated for
 * the blocking gap, and only when the blocking gap is at gate 3 or later.** If
 * the page is unreachable or out-ranked, no amount of copy will get it
 * retrieved, so the engine refuses and says what must be fixed first. Refusing
 * costs us an action in the queue; generating anyway costs the customer their
 * content budget and, once they notice, their trust.
 *
 * Deterministic actions — a robots.txt line, a JSON-LD block, a list of pages
 * to link from — are emitted for every applicable gap regardless. They are
 * cheap, they are reversible, and none of them can fabricate anything.
 */
export async function generateActions(
  detections: DetectionResult[],
  options: GenerateOptions,
): Promise<GenerationOutcome[]> {
  const outcomes: GenerationOutcome[] = [];

  for (const detection of detections) {
    const blocking = detection.blocking;

    for (const gap of detection.gaps) {
      const actionType = ACTION_FOR_GAP[gap.gapType];
      if (actionType === null) continue;

      if (actionType === 'answer_block') {
        // `no_page` sits at gate 1 but writing the page IS its remedy, so it is
        // the one gate-1 gap that earns a content action rather than blocking
        // one. Every other early-gate blocker means the page cannot be
        // retrieved at all.
        const blocksContent =
          blocking !== null && blocking.blockedAtGate < 3 && blocking.gapType !== 'no_page';

        if (blocksContent) {
          outcomes.push({
            kind: 'refused',
            refusal: {
              gap,
              actionType,
              reason: 'not_retrievable',
              needed: notRetrievableMessage(blocking!),
            },
          });
          continue;
        }

        // Past that, only the blocking gap earns the content action.
        if (blocking !== null && gap !== blocking) continue;

        const result = await generateAnswerBlock(
          {
            prompt: gap.prompt,
            facts: options.facts,
            rivalPassage: typeof gap.evidence['rivalPassage'] === 'string'
              ? gap.evidence['rivalPassage']
              : null,
            existingPassage: typeof gap.evidence['bestPassageText'] === 'string'
              ? gap.evidence['bestPassageText']
              : null,
            brandName: options.brandName,
          },
          options.writer,
          options,
        );

        if (!result.ok) {
          outcomes.push({
            kind: 'refused',
            refusal: { gap, actionType, reason: result.reason, needed: result.needed },
          });
          continue;
        }

        outcomes.push({
          kind: 'action',
          action: toAction(gap, actionType, result.artifact, options,
            'The engine answers this prompt from a competitor passage. This block ' +
            'states the same answer from first-party facts, in the 40-90 word shape ' +
            'retrievers extract.'),
        });
        continue;
      }

      if (actionType === 'rank_first') {
        // Advisory: it carries real information but changes nothing on its own,
        // so it gets an action with no artifact rather than a silent drop.
        outcomes.push({
          kind: 'action',
          action: toAction(gap, actionType, null, options,
            `This page ranks at position ${String(gap.evidence['organicPosition'])}, ` +
            'below the range engines retrieve from. No on-page copy will change that. ' +
            'Fix the classic ranking first; this prompt is not addressable until then.'),
        });
        continue;
      }

      const artifact = await buildDeterministic(gap, actionType, options);
      if (artifact === null) continue;

      outcomes.push({
        kind: 'action',
        action: toAction(gap, actionType, artifact, options, String(gap.evidence['reason'])),
      });
    }
  }

  return outcomes.sort(byPriorityDesc);
}

async function buildDeterministic(
  gap: Gap,
  actionType: ActionType,
  options: GenerateOptions,
): Promise<Action['artifact']> {
  switch (actionType) {
    case 'crawl_fix':
      return buildCrawlFix(gap);

    case 'schema': {
      if (gap.ourUrl === null) return null;
      const expected = Array.isArray(gap.evidence['expected'])
        ? (gap.evidence['expected'] as string[])
        : ['FAQPage'];
      return buildSchema({
        url: gap.ourUrl,
        html: options.pageHtml?.[gap.ourUrl] ?? '',
        brandName: options.brandName,
        types: expected,
        facts: options.facts,
      });
    }

    case 'internal_link':
      return gap.ourUrl === null
        ? null
        : buildInternalLink(gap, gap.ourUrl, options.linkSources ?? []);

    case 'placement': {
      const pitch = options.pitchWriter === undefined ? null : await options.pitchWriter(gap);
      return buildPlacement(gap, pitch);
    }

    default:
      return null;
  }
}

function toAction(
  gap: Gap,
  actionType: ActionType,
  artifact: Action['artifact'],
  options: GenerateOptions,
  rationale: string,
): Action {
  return {
    actionType,
    gap,
    targetUrl: gap.ourUrl,
    certainty: gap.certainty,
    artifact,
    rationale,
    priority: priorityFor({
      actionType,
      certainty: gap.certainty,
      ...(options.intents?.[gap.prompt] === undefined
        ? {}
        : { intent: options.intents[gap.prompt] }),
      ...(options.engineWeights?.[gap.engine] === undefined
        ? {}
        : { engineWeight: options.engineWeights[gap.engine] }),
      ...(options.winRates?.[actionType] === undefined
        ? {}
        : { historicalWinRate: options.winRates[actionType] }),
    }),
  };
}

function notRetrievableMessage(blocking: Gap): string {
  const first: Record<string, string> = {
    bot_blocked: 'the crawler block',
    js_only: 'the JavaScript-only rendering',
    no_page: 'the missing page',
    not_ranking: 'the classic ranking',
  };
  const what = first[blocking.gapType] ?? blocking.gapType;
  return (
    `Fix ${what} first. Until then the engine cannot retrieve this page, so a ` +
    'generated block would sit on it unread — spending the content budget with no ' +
    'possible return.'
  );
}

function byPriorityDesc(a: GenerationOutcome, b: GenerationOutcome): number {
  const priority = (outcome: GenerationOutcome): number =>
    outcome.kind === 'action' ? outcome.action.priority : -1;
  return priority(b) - priority(a);
}
