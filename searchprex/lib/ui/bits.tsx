import type { Certainty } from '@/src/gaps/types';
import type { EngineVerdict, Verdict } from '@/lib/data/types';

const ENGINE_LABEL: Record<string, string> = {
  perplexity: 'Perplexity',
  openai: 'ChatGPT',
  gemini: 'Gemini',
  aio: 'AI Overviews',
  copilot: 'Copilot',
};

export function engineLabel(key: string): string {
  return ENGINE_LABEL[key] ?? key;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  cited: 'Cited',
  contested: 'Contested',
  absent: 'Absent',
  unknown: 'No data',
};

/**
 * Status is never colour alone: every verdict ships its dot beside a word, so
 * the meaning survives colourblindness, greyscale printing and forced-colors.
 */
export function VerdictTag({ verdict }: { verdict: Verdict }) {
  return (
    <span className="verdict">
      <span className={`dot dot-${verdict}`} aria-hidden="true" />
      {VERDICT_TEXT[verdict]}
    </span>
  );
}

/**
 * Cited in N of M attempts, as filled pips.
 *
 * The denominator is always drawn. A bare "1" would read as a win; "1 of 3"
 * reads as what it is — the engine citing you sometimes.
 */
export function CitationMeter({ cited, total }: { cited: number; total: number }) {
  if (total === 0) return <span className="gate">no successful calls</span>;
  return (
    <span className="meter" title={`cited in ${cited} of ${total} attempts`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pip${i < cited ? ' pip-on' : ''}`} aria-hidden="true" />
      ))}
      <span className="gate" style={{ marginLeft: 4 }}>
        {cited}/{total}
      </span>
    </span>
  );
}

export function EngineCell({ verdict }: { verdict: EngineVerdict }) {
  return (
    <div>
      <VerdictTag verdict={verdict.verdict} />
      <div style={{ marginTop: 3 }}>
        <CitationMeter cited={verdict.cited} total={verdict.total} />
      </div>
    </div>
  );
}

/**
 * Certainty is shown on every recommendation. A hypothesis and a proven lever
 * must not arrive looking the same — the customer prices the work off this.
 */
export function CertaintyBadge({ certainty }: { certainty: Certainty }) {
  return <span className={`badge badge-${certainty}`}>{certainty}</span>;
}

export function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note === undefined ? null : <div className="tile-note">{note}</div>}
    </div>
  );
}

export function pct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
