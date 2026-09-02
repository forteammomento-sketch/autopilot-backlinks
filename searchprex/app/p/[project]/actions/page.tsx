import { data } from '@/lib/data/index';
import { CertaintyBadge, engineLabel } from '@/lib/ui/bits';

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

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const [actions, refusals] = await Promise.all([data.actions(project), data.refusals(project)]);

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
