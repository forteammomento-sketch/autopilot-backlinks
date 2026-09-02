import { data, isLive, mutations } from '@/lib/data/index';
import { CertaintyBadge, engineLabel } from '@/lib/ui/bits';
import { SubmitButton } from '@/lib/ui/submit-button';
import {
  approveAction,
  clearLastOutcome,
  clearLastRollback,
  deployApproved,
  readLastOutcome,
  readLastRollback,
  rejectAction,
  rollbackAction,
  unapproveAction,
} from './server-actions';
import type { ActionRow, DeployOutcome, RollbackOutcome } from '@/lib/data/types';

const GATE_NAME: Record<number, string> = {
  1: 'retrievable',
  2: 'ranked',
  3: 'extractable',
  4: 'corroborated',
};

const REFUSAL_TITLE: Record<string, string> = {
  no_first_party_facts: 'No first-party facts',
  not_retrievable: 'Page is not retrievable yet',
  duplicate_of_existing: 'Would duplicate existing copy',
  validation_failed: 'Draft failed validation',
};

/** Action types the deploy pipeline can ship in V0. */
const DEPLOYABLE = new Set(['answer_block', 'schema', 'crawl_fix']);

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const [actions, refusals, outcome, rollback] = await Promise.all([
    data.actions(project),
    data.refusals(project),
    readLastOutcome(project),
    readLastRollback(project),
  ]);

  const approved = actions.filter((a) => a.status === 'approved');
  const shippable = approved.filter((a) => DEPLOYABLE.has(a.actionType));

  return (
    <>
      <div className="page-head">
        <h1>Actions</h1>
        <p>
          Ranked by leverage × certainty ÷ effort. Work the top of the list — an item
          low down is not a smaller version of the one above it, it is a different
          gate.
        </p>
      </div>

      {isLive ? null : (
        <p className="envnote">
          Fixture data — Supabase is not configured, so nothing here is real and no
          deploy will reach a repository.
        </p>
      )}

      {outcome === null ? null : <OutcomeBanner outcome={outcome} project={project} />}
      {rollback === null ? null : <RollbackBanner outcome={rollback} project={project} />}

      <DeployBar project={project} approved={approved.length} shippable={shippable.length} />

      {actions.map((action, index) => (
        <details key={action.id} className="action" open={action.priority > 2.5}>
          <summary>
            <span className="disclose" aria-hidden="true">
              ▸
            </span>
            <span>
              <span className="rank">{index + 1}. </span>
              <span className="action-type">{action.actionType.replace('_', ' ')}</span>
            </span>
            <span className="action-prompt">{action.prompt}</span>
            <span className="action-meta">
              <StatusPill status={action.status} />
              {action.preview === null ? (
                <span className="badge badge-advisory">advisory</span>
              ) : null}
              <span className="gate">
                gate {action.gate} · {GATE_NAME[action.gate]}
              </span>
              <CertaintyBadge certainty={action.certainty} />
              <span className="gate">{engineLabel(action.engine)}</span>
            </span>
          </summary>

          <div className="action-body">
            <p className={`rationale${action.actionType === 'rank_first' ? ' advisory' : ''}`}>
              {action.rationale}
            </p>

            {action.targetUrl === null ? null : (
              <p className="url" style={{ marginTop: -6, marginBottom: 12 }}>
                {action.targetUrl}
              </p>
            )}

            {action.preview === null ? (
              <p className="note">
                <strong>Advisory — nothing to deploy.</strong> This one is here because it
                explains why the prompt is unaddressable, not because there is copy to
                approve.
              </p>
            ) : (
              <>
                <p className="preview-label">{action.preview.label}</p>
                <pre className="preview">{action.preview.body}</pre>
              </>
            )}

            <RowControls project={project} action={action} />
          </div>
        </details>
      ))}

      <h2 className="section">Held back ({refusals.length})</h2>
      <p className="note" style={{ marginBottom: 12 }}>
        The engine declined to generate these, and each says what would unblock it. A
        refusal is information, not an error: with nothing first-party to say, a
        generated block can only restate the competitor page that is already cited —
        which adds a near-duplicate passage to a catalogue that already has that problem.
      </p>

      {refusals.map((refusal) => (
        <div key={refusal.id} className="refusal">
          <div className="refusal-head">
            <span className="refusal-reason">
              {REFUSAL_TITLE[refusal.reason] ?? refusal.reason}
            </span>
            <span className="gate">
              {refusal.actionType.replace('_', ' ')} · {engineLabel(refusal.engine)}
            </span>
          </div>
          <p className="url" style={{ marginBottom: 6 }}>
            {refusal.prompt}
          </p>
          <p className="refusal-needed">{refusal.needed}</p>
        </div>
      ))}
    </>
  );
}

function StatusPill({ status }: { status: ActionRow['status'] }) {
  if (status === 'draft') return null;
  return <span className={`pill pill-${status}`}>{status}</span>;
}

/**
 * Approve and Deploy are separate buttons on purpose. Approving records that a
 * person read the artifact; deploying opens a pull request against a production
 * site. One click doing both would mean a stray tap ships generated copy.
 */
function RowControls({ project, action }: { project: string; action: ActionRow }) {
  if (action.preview === null) {
    return (
      <div className="row-actions">
        <span className="gate">Advisory — nothing to approve.</span>
      </div>
    );
  }

  if (action.status === 'deployed' || action.status === 'verified') {
    return (
      <div className="row-actions">
        <span className="gate">
          Shipped. Rolling back opens a revert pull request from the snapshot taken
          before the deploy.
        </span>
        {/* Two clicks, because this writes to a production repository. */}
        <details className="confirm">
          <summary className="btn btn-quiet">Roll back…</summary>
          <form action={rollbackAction}>
            <input type="hidden" name="project" value={project} />
            <input type="hidden" name="id" value={action.id} />
            <SubmitButton className="btn" pendingLabel="Opening revert…">
              Confirm rollback
            </SubmitButton>
          </form>
        </details>
      </div>
    );
  }

  const deployable = DEPLOYABLE.has(action.actionType);

  return (
    <div className="row-actions">
      {action.status === 'approved' ? (
        <>
          <form action={unapproveAction}>
            <input type="hidden" name="project" value={project} />
            <input type="hidden" name="id" value={action.id} />
            <SubmitButton className="btn" pendingLabel="Taking back…">
              Take approval back
            </SubmitButton>
          </form>
          <span className="gate">
            {deployable
              ? 'Queued for the next deploy.'
              : 'Approved, but V0 has no automated deploy for this type — do it by hand.'}
          </span>
        </>
      ) : (
        <>
          <form action={approveAction}>
            <input type="hidden" name="project" value={project} />
            <input type="hidden" name="id" value={action.id} />
            <SubmitButton className="btn btn-primary" pendingLabel="Approving…">
              Approve
            </SubmitButton>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="project" value={project} />
            <input type="hidden" name="id" value={action.id} />
            <SubmitButton className="btn btn-quiet" pendingLabel="Rejecting…">
              Reject
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}

function DeployBar({
  project,
  approved,
  shippable,
}: {
  project: string;
  approved: number;
  shippable: number;
}) {
  return (
    <div className="deploybar">
      <div className="deploybar-text">
        {approved === 0 ? (
          <>Nothing approved yet. Approve the artifacts you want before deploying.</>
        ) : (
          <>
            <strong>
              {shippable} of {approved} approved
            </strong>{' '}
            {shippable === 1 ? 'action can' : 'actions can'} be shipped as one draft pull
            request. Placement and internal-link work is done by hand.
          </>
        )}
      </div>
      <form action={deployApproved}>
        <input type="hidden" name="project" value={project} />
        <SubmitButton
          className="btn btn-primary"
          pendingLabel="Opening pull request…"
          disabled={shippable === 0}
        >
          Open draft pull request
        </SubmitButton>
      </form>
    </div>
  );
}

function OutcomeBanner({ outcome, project }: { outcome: DeployOutcome; project: string }) {
  const tone =
    outcome.kind === 'opened'
      ? 'banner-good'
      : outcome.kind === 'planned'
        ? 'banner-info'
        : outcome.kind === 'nothing'
          ? 'banner-warn'
          : 'banner-bad';

  return (
    <div className={`banner ${tone}`}>
      {outcome.kind === 'opened' ? (
        <>
          <h3>Draft pull request opened</h3>
          <p>
            Nothing is live until someone merges it.{' '}
            <a href={outcome.prUrl}>#{outcome.prNumber}</a>
          </p>
          <FileList files={outcome.files} capped={outcome.capped} />
        </>
      ) : null}

      {outcome.kind === 'planned' ? (
        <>
          <h3>Plan built — nothing was pushed</h3>
          <p>{outcome.why}</p>
          <FileList files={outcome.files} capped={outcome.capped} />
        </>
      ) : null}

      {outcome.kind === 'nothing' ? (
        <>
          <h3>Nothing to deploy</h3>
          <p>{outcome.why}</p>
        </>
      ) : null}

      {outcome.kind === 'error' ? (
        <>
          <h3>Deploy failed</h3>
          <p>{outcome.message}</p>
          <p>
            Nothing was left half-applied: the deploy compares each file against the
            snapshot it planned from and stops rather than overwriting a change that
            landed in between.
          </p>
        </>
      ) : null}

      <form action={clearLastOutcome} className="banner-close">
        <input type="hidden" name="project" value={project} />
        <SubmitButton className="btn btn-quiet" pendingLabel="…">
          Dismiss
        </SubmitButton>
      </form>
    </div>
  );
}

function RollbackBanner({
  outcome,
  project,
}: {
  outcome: RollbackOutcome;
  project: string;
}) {
  const tone =
    outcome.kind === 'reverted'
      ? 'banner-good'
      : outcome.kind === 'restored'
        ? 'banner-info'
        : outcome.kind === 'nothing'
          ? 'banner-warn'
          : 'banner-bad';

  return (
    <div className={`banner ${tone}`}>
      {outcome.kind === 'reverted' ? (
        <>
          <h3>Revert pull request opened</h3>
          <p>
            The files are restored in <a href={outcome.prUrl}>#{outcome.prNumber}</a>. Nothing
            is undone on the live site until it merges.
          </p>
          <ul>
            {outcome.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {outcome.kind === 'restored' ? (
        <>
          <h3>Rolled back</h3>
          <p>{outcome.why}</p>
        </>
      ) : null}

      {outcome.kind === 'nothing' ? (
        <>
          <h3>Nothing to roll back</h3>
          <p>{outcome.why}</p>
        </>
      ) : null}

      {outcome.kind === 'error' ? (
        <>
          <h3>Rollback failed</h3>
          <p>{outcome.message}</p>
          <p>
            The deployment record still holds the pre-deploy snapshot, so the revert can
            be retried or applied by hand.
          </p>
        </>
      ) : null}

      <form action={clearLastRollback} className="banner-close">
        <input type="hidden" name="project" value={project} />
        <SubmitButton className="btn btn-quiet" pendingLabel="…">
          Dismiss
        </SubmitButton>
      </form>
    </div>
  );
}

function FileList({
  files,
  capped,
}: {
  files: { path: string; applied: string[] }[];
  capped: number;
}) {
  return (
    <>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <code>{file.path}</code> — {file.applied.join(', ')}
          </li>
        ))}
      </ul>
      {capped > 0 ? (
        <p style={{ marginTop: 8 }}>
          {capped} further block{capped === 1 ? '' : 's'} held back by the per-run cap.
          Publishing many generated passages at once is the pattern that trips spam
          classification, so they follow in a later run.
        </p>
      ) : null}
    </>
  );
}
