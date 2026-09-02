import { data } from '@/lib/data/index';

const INTENT_NOTE: Record<string, string> = {
  commercial: 'buying intent — weighted highest in the action ranker',
  comparison: 'evaluating options',
  informational: 'researching',
  brand: 'already looking for you',
};

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const [summary, prompts] = await Promise.all([data.project(project), data.prompts(project)]);
  if (summary === null) return null;

  const clusters = [...new Set(prompts.map((p) => p.cluster))];

  return (
    <>
      <div className="page-head">
        <h1>Prompt universe</h1>
        <p>
          The questions checked against every engine, {summary.promptCount} in total across{' '}
          {clusters.length} clusters. Intent decides how much a win here is worth: a
          commercial prompt outranks an informational one in the action queue.
        </p>
      </div>

      {clusters.map((cluster) => (
        <div key={cluster}>
          <h2 className="section">{cluster}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Intent</th>
                </tr>
              </thead>
              <tbody>
                {prompts
                  .filter((p) => p.cluster === cluster)
                  .map((prompt) => (
                    <tr key={prompt.id}>
                      <td>{prompt.text}</td>
                      <td>
                        <div>{prompt.intent}</div>
                        <div className="gate">{INTENT_NOTE[prompt.intent]}</div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="note" style={{ marginTop: 18 }}>
        <strong>Prompt generation is not built yet.</strong> These are entered by hand.
        Twenty to thirty covering the questions your buyers actually ask is enough to
        start — the loop does not get better with a longer list, it gets more expensive.
      </p>
    </>
  );
}
