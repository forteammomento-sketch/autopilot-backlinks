import { data, isLive } from '@/lib/data/index';
import { SubmitButton } from '@/lib/ui/submit-button';
import {
  clearLastGeneration,
  generatePromptsAction,
  readLastGeneration,
} from './server-actions';
import type { PromptGenerationOutcome } from '@/lib/data/types';

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
  const [summary, prompts, generation] = await Promise.all([
    data.project(project),
    data.prompts(project),
    readLastGeneration(project),
  ]);
  if (summary === null) return null;

  const clusters = [...new Set(prompts.map((p) => p.cluster))];
  const engines = Math.max(1, summary.engines.length);

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

      {isLive ? null : (
        <p className="envnote">
          Fixture data — Supabase is not configured, so generated prompts are shown but
          saved nowhere.
        </p>
      )}

      {generation === null ? null : (
        <GenerationBanner outcome={generation} project={project} engines={engines} />
      )}

      <div className="deploybar">
        <div className="deploybar-text">
          <strong>
            {summary.promptCount} prompts × {engines} engine{engines === 1 ? '' : 's'} × 3
            attempts = {summary.promptCount * engines * 3} calls a run.
          </strong>{' '}
          The size of this set is the largest recurring cost in the product. A bigger set
          does not make the loop better, only more expensive.
        </div>
        <form action={generatePromptsAction}>
          <input type="hidden" name="project" value={project} />
          <SubmitButton className="btn btn-primary" pendingLabel="Crawling and writing…">
            Generate prompts
          </SubmitButton>
        </form>
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
    </>
  );
}

function GenerationBanner({
  outcome,
  project,
  engines,
}: {
  outcome: PromptGenerationOutcome;
  project: string;
  engines: number;
}) {
  const tone =
    outcome.kind === 'generated'
      ? 'banner-good'
      : outcome.kind === 'preview'
        ? 'banner-info'
        : outcome.kind === 'unconfigured'
          ? 'banner-warn'
          : 'banner-bad';

  return (
    <div className={`banner ${tone}`}>
      {outcome.kind === 'generated' || outcome.kind === 'preview' ? (
        <>
          <h3>
            {outcome.kind === 'generated'
              ? `${outcome.prompts.length} prompts added`
              : `${outcome.prompts.length} prompts generated — not saved`}
          </h3>
          {outcome.kind === 'preview' ? <p>{outcome.why}</p> : null}
          <p>
            {outcome.rejected} candidate{outcome.rejected === 1 ? '' : 's'} rejected —
            duplicates, keywords rather than questions, and any that named the brand,
            which the shop would nearly always win.
          </p>
          <p>
            Adds <strong>{outcome.weeklyCalls * engines} calls</strong> to every run
            across {engines} engine{engines === 1 ? '' : 's'}.
          </p>
          <ul>
            {outcome.prompts.slice(0, 12).map((prompt) => (
              <li key={prompt.text}>
                {prompt.text} <span className="gate">· {prompt.intent}</span>
              </li>
            ))}
          </ul>
          {outcome.prompts.length > 12 ? (
            <p style={{ marginTop: 6 }}>
              and {outcome.prompts.length - 12} more.
            </p>
          ) : null}
        </>
      ) : null}

      {outcome.kind === 'unconfigured' ? (
        <>
          <h3>Nothing generated</h3>
          <p>{outcome.why}</p>
        </>
      ) : null}

      {outcome.kind === 'error' ? (
        <>
          <h3>Generation failed</h3>
          <p>{outcome.message}</p>
        </>
      ) : null}

      <form action={clearLastGeneration} className="banner-close">
        <input type="hidden" name="project" value={project} />
        <SubmitButton className="btn btn-quiet" pendingLabel="…">
          Dismiss
        </SubmitButton>
      </form>
    </div>
  );
}
