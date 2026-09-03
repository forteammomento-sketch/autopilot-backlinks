import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runJobs, type JobName } from '@/lib/jobs/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOBS = new Set<JobName>(['measure', 'remeasure']);

/**
 * The scheduler-agnostic trigger.
 *
 * Deliberately an HTTP endpoint rather than a binding to one job runner:
 * Vercel Cron, pg_cron, GitHub Actions and Inngest can all POST to it, and
 * which of those a deployment uses is the operator's decision, not this
 * package's. The parts that must not be got wrong — the lease, the budget, the
 * partial-failure handling — live below this line where they are the same
 * whatever calls in.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  if (!authorised(request)) {
    // The endpoint spends money. An unauthenticated caller must not be able to
    // learn whether a job name exists, so this check comes first.
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { job } = await params;
  if (!JOBS.has(job as JobName)) {
    return NextResponse.json({ error: `unknown job "${job}"` }, { status: 404 });
  }

  // Without `?project=` this runs every project, which is what a single cron
  // entry for a multi-tenant deployment needs. With one, it runs just that one.
  const projectRef = new URL(request.url).searchParams.get('project') ?? undefined;
  const outcomes = await runJobs(job as JobName, projectRef);

  // One tenant failing must not report the whole sweep as failed, so the status
  // reflects the worst outcome only when nothing succeeded.
  const ran = outcomes.some((o) => o.kind === 'ran');
  const worst = outcomes[0];
  const status = ran
    ? 200
    : worst?.kind === 'busy'
      ? 409
      : worst?.kind === 'unconfigured'
        ? 503
        : 500;

  return NextResponse.json({ outcomes }, { status });
}

function authorised(request: Request): boolean {
  const expected = process.env['SEARCHPREX_JOB_SECRET'];
  if (expected === undefined || expected === '') return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare lengths separately: timingSafeEqual throws on a mismatch, and
  // padding to a common length before comparing keeps the timing flat.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
