import { buildDeployPlan, staticSiteResolver } from '@/src/deploy/plan';
import type { Action } from '@/src/actions/types';
import { fixtureActions, fixturePrompts, fixtureRepo, fixtureSeeds } from '@/lib/data/fixtures';
import { generatePrompts } from '@/src/prompts/generate';
import { TemplatePromptWriter } from '@/src/prompts/template-writer';
import { getFixtureStatus, setFixtureStatus } from '@/lib/data/fixture-state';
import type {
  DeployOutcome,
  PromptGenerationOutcome,
  MutationResult,
  MutationSource,
  PlannedFile,
  RollbackOutcome,
} from '@/lib/data/types';

/**
 * In-memory mutations for the fixture environment.
 *
 * State lives in a module-level map, so it survives navigation within a running
 * dev server and resets on restart. That is the right trade for a demo: the
 * buttons do something real enough to review the flow, and nothing pretends to
 * be persisted.
 */
function currentStatus(id: string): string {
  const action = fixtureActions.find((a) => a.id === id);
  return getFixtureStatus(id, (action?.status ?? 'draft') as 'draft');
}

export const fixtureMutations: MutationSource = {
  approve: async (_project, actionId) => {
    if (currentStatus(actionId) !== 'draft') {
      return { ok: false, message: 'Only a draft action can be approved.' };
    }
    setFixtureStatus(actionId, 'approved');
    return { ok: true };
  },

  unapprove: async (_project, actionId) => {
    if (currentStatus(actionId) !== 'approved') {
      return { ok: false, message: 'Only an approved action can be taken back.' };
    }
    setFixtureStatus(actionId, 'draft');
    return { ok: true };
  },

  reject: async (_project, actionId) => {
    if (currentStatus(actionId) === 'deployed') {
      return { ok: false, message: 'This is already deployed — roll it back instead.' };
    }
    setFixtureStatus(actionId, 'rejected');
    return { ok: true };
  },

  generatePrompts: async (): Promise<PromptGenerationOutcome> => {
    // The template writer, not a model: this demonstrates the validation,
    // deduplication, caps and cost report without an API key. Everything it
    // produces is obviously templated, which is what keeps it from being
    // mistaken for a real prompt set.
    const report = await generatePrompts(
      fixtureSeeds,
      {
        topic: 'knives and outdoor gear',
        brandAliases: ['Michigan Sports Outdoor', 'MSO'],
      },
      new TemplatePromptWriter(),
      { existing: fixturePrompts.map((p) => p.text), maxTotal: 12, maxPerCluster: 3 },
    );

    return {
      kind: 'preview',
      prompts: report.prompts.map((p) => ({ text: p.text, intent: p.intent, cluster: p.cluster })),
      rejected: report.rejected.length,
      weeklyCalls: report.weeklyCallsPerEngine,
      why:
        'Fixture environment — written from templates rather than a model, and saved ' +
        'nowhere. With Supabase and OPENAI_API_KEY set, this crawls the site for seeds, ' +
        'writes the set and stores it.',
    };
  },

  rollback: async (_project, actionId): Promise<RollbackOutcome> => {
    if (currentStatus(actionId) !== 'deployed') {
      return { kind: 'nothing', why: 'This action has not been deployed.' };
    }
    setFixtureStatus(actionId, 'draft');
    return {
      kind: 'restored',
      files: [],
      why:
        'Fixture environment — the action is back to draft and nothing was pushed. ' +
        'Against a real project this opens a revert pull request from the stored ' +
        'pre-deploy snapshot.',
    };
  },

  deployApproved: async () => {
    const approved = fixtureActions.filter((a) => currentStatus(a.id) === 'approved');
    if (approved.length === 0) {
      return { kind: 'nothing', why: 'Nothing is approved yet.' };
    }

    const plan = await buildDeployPlan(approved.map(toCoreAction), {
      resolver: staticSiteResolver(),
      readFile: async (path) => fixtureRepo[path] ?? null,
    });

    if (plan.changes.length === 0) {
      return {
        kind: 'nothing',
        why:
          plan.skipped[0]?.reason ??
          'The approved actions produced no file changes — they may already be live.',
      };
    }

    for (const action of approved) setFixtureStatus(action.id, 'deployed');

    return {
      kind: 'planned',
      files: plan.changes.map(toPlannedFile),
      capped: plan.cappedCount,
      why:
        'Fixture environment — the plan was built and nothing was written. This project ' +
        'deploys to Shopify, where an approved change goes to the live storefront with no ' +
        'pull request in between. Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN to apply it.',
    };
  },
};

function toPlannedFile(change: { path: string; applied: { actionType: string }[] }): PlannedFile {
  return { path: change.path, applied: change.applied.map((a) => a.actionType) };
}

/** Fixture rows carry the view model; the deploy planner wants the core type. */
function toCoreAction(row: (typeof fixtureActions)[number]): Action {
  return {
    actionType: row.actionType,
    gap: {
      prompt: row.prompt,
      engine: row.engine,
      gapType: row.gapType,
      blockedAtGate: row.gate,
      ourUrl: row.targetUrl,
      rivalUrl: null,
      certainty: row.certainty,
      evidence: { reason: row.rationale },
    },
    targetUrl: row.targetUrl,
    priority: row.priority,
    certainty: row.certainty,
    artifact: row.coreArtifact,
    rationale: row.rationale,
  };
}

export type { MutationResult, DeployOutcome, RollbackOutcome };
