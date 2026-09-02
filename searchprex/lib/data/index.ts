import { fixtureDataSource } from '@/lib/data/fixtures';
import { fixtureMutations } from '@/lib/data/mutations-fixture';
import {
  createSupabaseClient,
  createSupabaseData,
  createSupabaseMutations,
  githubConfigFromEnv,
} from '@/lib/data/supabase';
import type { DataSource, MutationSource } from '@/lib/data/types';

/**
 * The single place a screen gets data.
 *
 * Supabase when it is configured, fixtures otherwise. The fallback is
 * deliberate: `npm run dev` should show a working dashboard on a fresh clone,
 * and a half-configured environment should degrade to obviously-fake data
 * rather than to an empty screen the reader might mistake for "no gaps found".
 */
const client = createSupabaseClient();

export const isLive = client !== null;

export const data: DataSource =
  client === null ? fixtureDataSource : createSupabaseData(client, projectId());

export const mutations: MutationSource =
  client === null
    ? fixtureMutations
    : createSupabaseMutations(client, projectId(), githubConfigFromEnv());

function projectId(): string {
  return process.env['SEARCHPREX_PROJECT_ID'] ?? '';
}

export type * from '@/lib/data/types';
