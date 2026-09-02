import { buildDeployPlan, staticSiteResolver } from '@/src/deploy/plan';
import type { Action } from '@/src/actions/types';
import { fixtureActions, fixtureRepo } from '@/lib/data/fixtures';
import { getFixtureStatus, setFixtureStatus } from '@/lib/data/fixture-state';
import type { DeployOutcome, MutationResult, MutationSource, PlannedFile } from '@/lib/data/types';

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
        'GitHub is not configured for this project, so the plan was built and nothing was ' +
        'pushed. Set SEARCHPREX_GITHUB_TOKEN, _OWNER and _REPO to open the pull request.',
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

export type { MutationResult, DeployOutcome };
