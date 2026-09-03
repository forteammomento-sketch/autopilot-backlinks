import type { ActionType, RefusalReason } from '@/src/actions/types';
import type { Certainty, GapType } from '@/src/gaps/types';
import type { LiftDirection } from '@/src/measure/types';

/**
 * The shape the screens read.
 *
 * Deliberately a view model rather than the core types: a screen should not have
 * to walk a `SampledPrompt`'s attempts to render a row, and the Supabase
 * implementation will assemble these from SQL views rather than by loading the
 * whole object graph.
 */

export type Verdict = 'cited' | 'contested' | 'absent' | 'unknown';

export interface ProjectSummary {
  slug: string;
  name: string;
  domain: string;
  topic: string;
  lastRunAt: string;
  /** Citations gained in the last 30 days — the renewal metric. */
  citationsGained: number;
  promptCount: number;
  engines: string[];
  /**
   * Where deploys go. It changes what the UI may promise: a git target opens a
   * draft pull request a person reads first, and a Shopify target writes to the
   * live storefront with no equivalent step.
   */
  cmsKind: 'github' | 'shopify' | 'wordpress' | 'webflow' | 'snippet' | null;
}

export interface EngineVerdict {
  engine: string;
  verdict: Verdict;
  /** Cited in N of the attempts that succeeded. */
  cited: number;
  total: number;
}

export interface PromptRow {
  id: string;
  text: string;
  intent: 'informational' | 'comparison' | 'commercial' | 'brand';
  cluster: string;
  engines: EngineVerdict[];
  /** Competitor domains cited for this prompt. */
  rivals: string[];
}

export interface ActionRow {
  id: string;
  actionType: ActionType;
  gapType: GapType;
  gate: 1 | 2 | 3 | 4;
  prompt: string;
  engine: string;
  targetUrl: string | null;
  priority: number;
  certainty: Certainty;
  rationale: string;
  /** Mirrors the `actions.status` check constraint. */
  status: 'draft' | 'approved' | 'deployed' | 'verified' | 'failed' | 'rejected';
  /** Rendered artifact preview, or null for an advisory. */
  preview: { label: string; body: string } | null;
}

export interface RefusalRow {
  id: string;
  actionType: ActionType;
  reason: RefusalReason;
  prompt: string;
  engine: string;
  needed: string;
}

export interface PlacementRow {
  domain: string;
  promptsCovered: number;
  citationCount: number;
  /** True when a competitor is already cited on this domain. */
  rivalPresent: boolean;
  examplePrompt: string;
}

export interface ProofRow {
  id: string;
  actionType: ActionType;
  prompt: string;
  deployedAt: string;
  measuredAt: string | null;
  engines: {
    engine: string;
    before: { cited: number; total: number };
    after: { cited: number; total: number } | null;
    direction: LiftDirection | null;
    confident: boolean;
  }[];
  isControl: boolean;
  /** Set when the measurement could not be taken. */
  deferredReason: string | null;
}

export interface CohortSummary {
  treatedCount: number;
  controlCount: number;
  treatedDelta: number;
  controlDelta: number;
  netLift: number;
  hasControl: boolean;
}

export interface GscConnection {
  siteUrl: string | null;
  accountEmail: string | null;
  connectedAt: string;
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string;
}

/**
 * Reads for one project.
 *
 * Every method is bound to the project the source was built for. There is
 * deliberately no project argument: one that looked like it selected the tenant
 * but did not would eventually be passed the wrong value by someone who
 * believed it worked.
 */
export interface DataSource {
  project(): Promise<ProjectSummary | null>;
  prompts(): Promise<PromptRow[]>;
  actions(): Promise<ActionRow[]>;
  refusals(): Promise<RefusalRow[]>;
  placements(): Promise<PlacementRow[]>;
  proof(): Promise<ProofRow[]>;
  cohort(): Promise<CohortSummary>;
  /** The stored Search Console connection, or null when there is none. */
  connection(): Promise<GscConnection | null>;
  /** Properties the connected account can read, for the picker. */
  properties(): Promise<GscProperty[]>;
}

/* ── mutations ───────────────────────────────────────────────────────────── */

export type MutationResult = { ok: true } | { ok: false; message: string };

export interface PlannedFile {
  path: string;
  applied: string[];
}

/**
 * What a deploy did.
 *
 * `planned` is a first-class outcome, not a failure: the plan is built and
 * shown, and nothing is pushed. That is what happens when GitHub is not
 * configured, and it is also the honest state for a demo — reporting a pull
 * request URL that does not exist would be worse than reporting nothing.
 */
export type DeployOutcome =
  | { kind: 'opened'; prUrl: string; prNumber: number; files: PlannedFile[]; capped: number }
  /**
   * Written straight to a live storefront. Distinct from `opened` because
   * nothing reviews it afterwards — reporting a Shopify write as if a pull
   * request were waiting would tell someone their change is still pending when
   * it is already on the shop.
   */
  | { kind: 'applied'; target: string; files: PlannedFile[]; capped: number }
  | { kind: 'planned'; files: PlannedFile[]; capped: number; why: string }
  | { kind: 'nothing'; why: string }
  | { kind: 'error'; message: string };

export type RollbackOutcome =
  | { kind: 'reverted'; prUrl: string; prNumber: number; files: string[] }
  | { kind: 'restored'; files: string[]; why: string }
  | { kind: 'nothing'; why: string }
  | { kind: 'error'; message: string };

export interface GeneratedPromptRow {
  text: string;
  intent: PromptRow['intent'];
  cluster: string;
}

/**
 * `preview` is a first-class outcome, like `planned` is for a deploy: the set
 * was generated and shown, and nothing was saved. That happens when there is no
 * database to save into, and reporting it as a success would leave someone
 * believing a prompt set exists that does not.
 */
export type PromptGenerationOutcome =
  | { kind: 'generated'; prompts: GeneratedPromptRow[]; rejected: number; weeklyCalls: number }
  | {
      kind: 'preview';
      prompts: GeneratedPromptRow[];
      rejected: number;
      weeklyCalls: number;
      why: string;
    }
  | { kind: 'unconfigured'; why: string }
  | { kind: 'error'; message: string };

/** Writes for one project, bound the same way as `DataSource`. */
export interface MutationSource {
  /** Draft → approved. Records intent; deploys nothing. */
  approve(actionId: string): Promise<MutationResult>;
  /** Draft or approved → rejected. */
  reject(actionId: string): Promise<MutationResult>;
  /** Approved → draft, so an approval can be taken back before it ships. */
  unapprove(actionId: string): Promise<MutationResult>;
  /** Builds a plan from every approved action and, if configured, pushes it. */
  deployApproved(): Promise<DeployOutcome>;
  /**
   * Restore the files an action touched to their pre-deploy content.
   *
   * A revert pull request, never a force-push or a branch delete: the original
   * may already be merged, and rewriting history under a team that has pulled
   * it does more damage than the change being undone.
   */
  rollback(actionId: string): Promise<RollbackOutcome>;
  /** Crawls for seeds, generates a prompt set, and saves it where it can. */
  generatePrompts(): Promise<PromptGenerationOutcome>;
  /** Choose which Search Console property this project reads. */
  chooseProperty(siteUrl: string): Promise<MutationResult>;
  /** Forget the stored credential. */
  disconnectGoogle(): Promise<MutationResult>;
}
