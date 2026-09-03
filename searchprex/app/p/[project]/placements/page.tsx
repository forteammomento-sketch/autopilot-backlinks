import { notFound } from 'next/navigation';
import { projectContext } from '@/lib/auth/project';

export default async function PlacementsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const ctx = await projectContext(project);
  if (ctx === null) notFound();

  const placements = await ctx.data.placements();
  const max = Math.max(...placements.map((p) => p.citationCount), 1);

  return (
    <>
      <div className="page-head">
        <h1>Placements</h1>
        <p>
          The pages these engines already trust for your topic, ranked by how often they
          are cited for your prompts — not by domain authority. A mention on one of these
          is worth more than a link from a stronger domain the engines never quote.
        </p>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th className="num">Citations</th>
              <th style={{ width: '30%' }}>Share of your prompt set</th>
              <th className="num">Prompts</th>
              <th>Competitor already there</th>
            </tr>
          </thead>
          <tbody>
            {placements.map((placement) => (
              <tr key={placement.domain}>
                <td>
                  <div>{placement.domain}</div>
                  <div className="gate">e.g. {placement.examplePrompt}</div>
                </td>
                <td className="num">{placement.citationCount}</td>
                <td>
                  {/* One measure, one bar, anchored to a common baseline. */}
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--series-1)',
                      width: `${Math.round((placement.citationCount / max) * 100)}%`,
                      minWidth: 6,
                    }}
                    aria-hidden="true"
                  />
                </td>
                <td className="num">{placement.promptsCovered}</td>
                <td>
                  {placement.rivalPresent ? (
                    <span className="verdict">
                      <span className="dot dot-absent" aria-hidden="true" />
                      Yes — you are not
                    </span>
                  ) : (
                    <span className="verdict">
                      <span className="dot dot-unknown" aria-hidden="true" />
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note" style={{ marginTop: 14 }}>
        <strong>Why this list is different.</strong> It comes out of the citation graph the
        measurement loop already collects: every source cited for your prompts, with your
        own domain removed. A backlink tool ranks targets by authority; this ranks them by
        whether the engine answering your customers actually quotes them.
      </p>
    </>
  );
}
