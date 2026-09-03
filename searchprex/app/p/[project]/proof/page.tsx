import { notFound } from 'next/navigation';
import { projectContext } from '@/lib/auth/project';
import type { ProofRow } from '@/lib/data/types';
import { CitationMeter, Tile, engineLabel, pct, shortDate } from '@/lib/ui/bits';

const DIRECTION_LABEL: Record<string, string> = {
  gained: 'Gained',
  improved: 'Improved',
  unchanged: 'Unchanged',
  declined: 'Declined',
  lost: 'Lost',
};

export default async function ProofPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const ctx = await projectContext(project);
  if (ctx === null) notFound();

  const [rows, cohort] = await Promise.all([ctx.data.proof(), ctx.data.cohort()]);

  const treated = rows.filter((r) => !r.isControl);
  const control = rows.filter((r) => r.isControl);
  const deferred = rows.filter((r) => r.deferredReason !== null);

  return (
    <>
      <div className="page-head">
        <h1>Proof</h1>
        <p>
          Fourteen days after each deploy the same prompts run again. Prompts we did not
          touch run too, as a control — without them a before/after cannot tell your work
          apart from the engines simply reindexing.
        </p>
      </div>

      <div className="tiles">
        <Tile
          label="Net lift"
          value={pct(cohort.netLift)}
          note={`treated ${pct(cohort.treatedDelta)} − control ${pct(cohort.controlDelta)}`}
        />
        <Tile label="Acted on" value={String(cohort.treatedCount)} note="prompt/engine pairs" />
        <Tile label="Control" value={String(cohort.controlCount)} note="left untouched on purpose" />
        <Tile
          label="Awaiting measurement"
          value={String(deferred.length)}
          note="not yet live, or the run failed"
        />
      </div>

      {cohort.hasControl ? null : (
        <p className="note" style={{ marginTop: 14 }}>
          <strong>No control group in this cohort.</strong> The treated figure is what
          changed, not what this work caused.
        </p>
      )}

      <h2 className="section">Deployed ({treated.length})</h2>
      <ProofTable rows={treated} />

      <h2 className="section">Control — nothing was deployed ({control.length})</h2>
      <p className="note" style={{ marginBottom: 10 }}>
        These moved on their own. Whatever they gained is the drift that has to come off
        the treated number before any of it counts as ours.
      </p>
      <ProofTable rows={control} />
    </>
  );
}

function ProofTable({ rows }: { rows: ProofRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Action</th>
            <th>Engine</th>
            <th>Before</th>
            <th>After</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((row) =>
            row.engines.map((engine, i) => (
              <tr key={`${row.id}-${engine.engine}`}>
                {i === 0 ? (
                  <td rowSpan={row.engines.length}>
                    <div>{row.prompt}</div>
                    <div className="gate">deployed {shortDate(row.deployedAt)}</div>
                  </td>
                ) : null}
                {i === 0 ? (
                  <td rowSpan={row.engines.length} className="gate">
                    {row.actionType.replace('_', ' ')}
                  </td>
                ) : null}
                <td className="gate">{engineLabel(engine.engine)}</td>
                <td>
                  <CitationMeter cited={engine.before.cited} total={engine.before.total} />
                </td>
                <td>
                  {engine.after === null ? (
                    <span className="gate">—</span>
                  ) : (
                    <CitationMeter cited={engine.after.cited} total={engine.after.total} />
                  )}
                </td>
                <td>
                  {row.deferredReason !== null ? (
                    <span className="verdict">
                      <span className="dot dot-unknown" aria-hidden="true" />
                      Not measured
                      <span className="gate"> · rescheduled</span>
                    </span>
                  ) : engine.direction === null ? (
                    <span className="gate">—</span>
                  ) : (
                    <span className="verdict">
                      <span
                        className={`dot ${
                          engine.direction === 'gained' || engine.direction === 'improved'
                            ? 'dot-cited'
                            : engine.direction === 'unchanged'
                              ? 'dot-unknown'
                              : 'dot-absent'
                        }`}
                        aria-hidden="true"
                      />
                      {DIRECTION_LABEL[engine.direction]}
                      {/*
                        With three attempts a side, only a complete flip is
                        unambiguous. Everything else is directional evidence and
                        is labelled as such rather than dressed up as a win.
                      */}
                      <span className="gate">
                        {' '}
                        · {engine.confident ? 'clear' : 'directional'}
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
