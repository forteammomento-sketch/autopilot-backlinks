import type { Action, ActionType } from '../actions/types.js';

/** Maps a live URL to a path in the repository. */
export type PathResolver = (url: string) => string | null;

export interface FileChange {
  path: string;
  /**
   * The file exactly as it was before this run. Required, and captured before
   * anything is written: it is the rollback, and a deploy pipeline without one
   * is a pipeline that can only go forwards.
   */
  before: string;
  after: string;
  /** Actions folded into this change, in the order they were applied. */
  applied: { actionType: ActionType; rationale: string; blockId?: string }[];
}

export interface SkippedAction {
  actionType: ActionType;
  targetUrl: string | null;
  reason: string;
}

export interface DeployPlan {
  changes: FileChange[];
  skipped: SkippedAction[];
  /** Actions dropped by the per-run block cap. */
  cappedCount: number;
}

export interface DeployedFile {
  path: string;
  /** Rollback payload. */
  before: string;
}

export interface DeployRecord {
  method: 'github_pr';
  branch: string;
  baseBranch: string;
  files: DeployedFile[];
  prNumber?: number;
  prUrl?: string;
  deployedAt: string;
}

export interface PlanOptions {
  resolver: PathResolver;
  /** Reads a repository file, or null when it does not exist. */
  readFile: (path: string) => Promise<string | null>;
  /**
   * Answer blocks written per run. Default 5.
   *
   * A cap is not politeness. Publishing dozens of generated passages across a
   * domain in one push is the shape that trips spam classification, and the
   * damage from that lands on the customer's whole site rather than on the
   * pages we touched.
   */
  maxBlocksPerRun?: number;
  /** Path to robots.txt in the repo. Default `robots.txt`. */
  robotsPath?: string;
}

export type DeployableAction = Action;
