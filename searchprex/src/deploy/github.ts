import type { DeployPlan, DeployRecord } from './types.js';

export interface GitHubFile {
  content: string;
  sha: string;
}

/**
 * The GitHub operations a deploy needs, behind an interface so the pipeline can
 * be tested without a network call and so a self-hosted Git host can be
 * substituted later.
 */
export interface GitHubClient {
  getDefaultBranch(): Promise<string>;
  getRefSha(branch: string): Promise<string>;
  createBranch(name: string, fromSha: string): Promise<void>;
  getFile(path: string, ref: string): Promise<GitHubFile | null>;
  putFile(args: {
    path: string;
    content: string;
    message: string;
    branch: string;
    sha?: string;
  }): Promise<void>;
  createPullRequest(args: {
    title: string;
    head: string;
    base: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string }>;
}

export interface DeployOptions {
  /** Branch name. Defaults to a timestamped `searchprex/` branch. */
  branch?: string;
  base?: string;
  /** Open the pull request as a draft. Default true. */
  draft?: boolean;
  titlePrefix?: string;
}

/**
 * Push a plan as a pull request.
 *
 * A pull request rather than a direct commit, and a draft by default: this
 * writes generated copy into someone's production site, and the diff is the
 * only place a human can see exactly what changed before it ships. Nothing here
 * merges, and nothing pushes to the default branch.
 */
export async function deployViaPullRequest(
  plan: DeployPlan,
  client: GitHubClient,
  options: DeployOptions = {},
): Promise<DeployRecord | null> {
  if (plan.changes.length === 0) return null;

  const base = options.base ?? (await client.getDefaultBranch());
  const branch = options.branch ?? `searchprex/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

  await client.createBranch(branch, await client.getRefSha(base));

  const files: DeployRecord['files'] = [];

  for (const change of plan.changes) {
    // Re-read on the new branch to pick up the blob sha the API requires, and
    // to fail loudly if the file moved between planning and deploying.
    const current = await client.getFile(change.path, branch);
    if (current === null) {
      throw new Error(`${change.path} disappeared between planning and deploy`);
    }
    if (current.content !== change.before) {
      throw new Error(
        `${change.path} changed since the plan was built — rebuild the plan rather than ` +
          'overwriting whatever landed in between',
      );
    }

    await client.putFile({
      path: change.path,
      content: change.after,
      message: commitMessageFor(change),
      branch,
      sha: current.sha,
    });

    files.push({ path: change.path, before: change.before });
  }

  const pr = await client.createPullRequest({
    title: `${options.titlePrefix ?? 'AI visibility'}: ${describe(plan)}`,
    head: branch,
    base,
    body: pullRequestBody(plan),
    draft: options.draft ?? true,
  });

  return {
    method: 'github_pr',
    branch,
    baseBranch: base,
    files,
    prNumber: pr.number,
    prUrl: pr.url,
    deployedAt: new Date().toISOString(),
  };
}

/**
 * Restore every file a deploy touched to its pre-deploy content, as a new pull
 * request.
 *
 * A revert rather than a force-push or a branch delete: the original pull
 * request may already be merged, and rewriting history under a team that has
 * pulled it causes more damage than the change being undone.
 */
export async function rollbackViaPullRequest(
  record: DeployRecord,
  client: GitHubClient,
  options: DeployOptions = {},
): Promise<{ number: number; url: string }> {
  const base = options.base ?? record.baseBranch;
  const branch = options.branch ?? `${record.branch}-revert`;

  await client.createBranch(branch, await client.getRefSha(base));

  for (const file of record.files) {
    const current = await client.getFile(file.path, branch);
    await client.putFile({
      path: file.path,
      content: file.before,
      message: `Revert Searchprex change to ${file.path}`,
      branch,
      ...(current === null ? {} : { sha: current.sha }),
    });
  }

  return client.createPullRequest({
    title: `Revert AI visibility changes (${record.branch})`,
    head: branch,
    base,
    body:
      `Restores ${String(record.files.length)} file(s) to their content before ` +
      `${record.prUrl ?? record.branch}.`,
    draft: false,
  });
}

function commitMessageFor(change: DeployPlan['changes'][number]): string {
  const kinds = [...new Set(change.applied.map((a) => a.actionType))].join(', ');
  return `Add ${kinds} to ${change.path}`;
}

function describe(plan: DeployPlan): string {
  const counts = new Map<string, number>();
  for (const change of plan.changes) {
    for (const applied of change.applied) {
      counts.set(applied.actionType, (counts.get(applied.actionType) ?? 0) + 1);
    }
  }
  return [...counts].map(([type, count]) => `${String(count)} ${type}`).join(', ');
}

function pullRequestBody(plan: DeployPlan): string {
  const lines: string[] = [
    'Generated by Searchprex to address prompts where this site was not cited.',
    '',
    '## Changes',
    '',
  ];

  for (const change of plan.changes) {
    lines.push(`### \`${change.path}\``, '');
    for (const applied of change.applied) {
      lines.push(`- **${applied.actionType}** — ${applied.rationale}`);
    }
    lines.push('');
  }

  if (plan.skipped.length > 0) {
    lines.push('## Not applied', '');
    for (const skipped of plan.skipped) {
      lines.push(`- **${skipped.actionType}** (${skipped.targetUrl ?? 'no URL'}) — ${skipped.reason}`);
    }
    lines.push('');
  }

  if (plan.cappedCount > 0) {
    lines.push(
      `${String(plan.cappedCount)} further block(s) were held back by the per-run cap. ` +
        'Publishing many generated passages at once is the pattern that trips spam ' +
        'classification, so they will follow in a later run.',
      '',
    );
  }

  lines.push('Every block is fenced by `searchprex:block` comments and can be removed in place.');
  return lines.join('\n');
}
