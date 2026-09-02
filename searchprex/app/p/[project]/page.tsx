import Link from 'next/link';
import { data } from '@/lib/data/index';
import { EngineCell, Tile, engineLabel, shortDate } from '@/lib/ui/bits';

export default async function VisibilityPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const [summary, prompts, actions] = await Promise.all([
    data.project(project),
    data.prompts(project),
    data.actions(project),
  ]);
  if (summary === null) return null;

  const engines = summary.engines;
  const rows = prompts.flatMap((p) => p.engines);
  const cited = rows.filter((r) => r.verdict === 'cited').length;
  const contested = rows.filter((r) => r.verdict === 'contested').length;
  const absent = rows.filter((r) => r.verdict === 'absent').length;

  // Sorted by fixability, not by volume: a prompt with an open action is one you
  // can do something about today, which is the only ordering that leads to work.
  const actionable = new Set(actions.map((a) => a.prompt));
  const sorted = [...prompts].sort((a, b) => {
    const byAction = Number(actionable.has(b.text)) - Number(actionable.has(a.text));
    return byAction !== 0 ? byAction : a.text.localeCompare(b.text);
  });

  return (
    <>
      <div className="page-head">
        <h1>Visibility</h1>
        <p>
          {summary.name} · {summary.topic} · last run {shortDate(summary.lastRunAt)}. Each
          prompt is asked three times per engine, because the same prompt does not get the
          same answer twice. Sorted by what you can act on today, not by volume.
        </p>
      </div>

      <div className="tiles">
        <Tile
          label="Citations gained · 30 days"
          value={String(summary.citationsGained)}
          note="prompt/engine pairs that went from absent to cited"
        />
        <Tile label="Cited" value={String(cited)} note={`of ${rows.length} prompt/engine pairs`} />
        <Tile label="Contested" value={String(contested)} note="cited in some attempts, not all" />
        <Tile label="Absent" value={String(absent)} note="never cited across three attempts" />
      </div>

      <h2 className="section">Prompts, most fixable first</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prompt</th>
              {engines.map((engine) => (
                <th key={engine}>{engineLabel(engine)}</th>
              ))}
              <th>Cited instead</th>
              <th>Open action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((prompt) => (
              <tr key={prompt.id}>
                <td>
                  <div>{prompt.text}</div>
                  <div className="gate">{prompt.intent}</div>
                </td>
                {engines.map((engine) => {
                  const verdict = prompt.engines.find((e) => e.engine === engine);
                  return (
                    <td key={engine}>
                      {verdict === undefined ? (
                        <span className="gate">—</span>
                      ) : (
                        <EngineCell verdict={verdict} />
                      )}
                    </td>
                  );
                })}
                <td className="url">
                  {prompt.rivals.length === 0 ? '—' : prompt.rivals.join(', ')}
                </td>
                <td>
                  {actionable.has(prompt.text) ? (
                    <Link href={`/p/${project}/actions`} className="fixable">
                      <span className="dot" aria-hidden="true" />
                      Yes
                    </Link>
                  ) : (
                    <span className="gate">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="legend">
        <span className="verdict">
          <span className="dot dot-cited" aria-hidden="true" />
          Cited — every attempt
        </span>
        <span className="verdict">
          <span className="dot dot-contested" aria-hidden="true" />
          Contested — some attempts
        </span>
        <span className="verdict">
          <span className="dot dot-absent" aria-hidden="true" />
          Absent — no attempt
        </span>
        <span className="verdict">
          <span className="dot dot-unknown" aria-hidden="true" />
          No data — every call failed
        </span>
      </p>
    </>
  );
}
