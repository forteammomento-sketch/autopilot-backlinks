import type { SupabaseClient } from '@supabase/supabase-js';

export interface HeldLease {
  id: string;
  release: (status: string, callsSpent: number, error: string | null) => Promise<void>;
}

/**
 * Take the lease for a job, or return null because someone else has it.
 *
 * Null is a normal outcome, not a failure. A second scheduler firing while the
 * first run is in flight should quietly do nothing — the work is already
 * happening, and running it twice costs a second full budget.
 */
export async function acquireLease(
  client: SupabaseClient,
  projectId: string,
  job: string,
  ttlSeconds: number,
): Promise<HeldLease | null> {
  const { data, error } = await client.rpc('acquire_job_lease', {
    p_project: projectId,
    p_job: job,
    p_ttl_seconds: ttlSeconds,
  });

  if (error !== null || data === null) return null;
  const id = String(data);

  return {
    id,
    release: async (status, callsSpent, err) => {
      await client.rpc('release_job_lease', {
        p_id: id,
        p_status: status,
        p_calls: callsSpent,
        p_error: err,
      });
    },
  };
}
