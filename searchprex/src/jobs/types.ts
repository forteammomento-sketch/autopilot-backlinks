import type { EngineAdapter } from '../engines/types.js';
import type { ProjectContext } from '../lib/citations.js';
import type { SampledPrompt } from '../runner/sample.js';

export interface JobPrompt {
  id: string;
  text: string;
  intent?: string;
}

export type JobStatus = 'completed' | 'budget_exhausted' | 'cancelled';

export interface MeasurementRun {
  status: JobStatus;
  results: (SampledPrompt & { promptId: string })[];
  /** Engine calls actually spent, for cost accounting. */
  callsSpent: number;
  /** Prompt/engine pairs left unmeasured when the run stopped early. */
  skipped: { promptId: string; engine: string; reason: string }[];
  startedAt: string;
  finishedAt: string;
}

export interface MeasurementDeps {
  adapters: Record<string, EngineAdapter>;
  context: ProjectContext;
  repeats?: number;
  /** Persist each result as it lands, so a run that dies keeps its work. */
  onResult?: (result: SampledPrompt & { promptId: string }) => Promise<void>;
  signal?: AbortSignal;
  locale?: string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A lease over a named job, so two schedulers firing at once do not both run it.
 *
 * Cron is not exactly-once anywhere: a retry, two regions, or a manual trigger
 * beside the schedule all produce a second call. Without a lease that second
 * call spends the whole budget again.
 */
export interface JobLease {
  /** Returns a release handle, or null when someone else holds the lease. */
  acquire(key: string, ttlSeconds: number): Promise<{ release: () => Promise<void> } | null>;
}
