import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { fixtureDataSource } from '@/lib/data/fixtures';
import { fixtureMutations } from '@/lib/data/mutations-fixture';
import {
  createSupabaseData,
  createSupabaseMutations,
  githubConfigFromEnv,
  shopifyConfigFromEnv,
} from '@/lib/data/supabase';
import { createSupabaseSessionSource } from '@/lib/auth/supabase-session';
import type { Session } from '@/lib/auth/types';
import type { DataSource, MutationSource } from '@/lib/data/types';

export interface ProjectContext {
  slug: string;
  projectId: string;
  session: Session | null;
  /** Reads. Bound to this project and, when live, scoped to the user's JWT. */
  data: DataSource;
  /** Writes. Service-role, and only ever reachable for a verified project. */
  mutations: MutationSource;
  isLive: boolean;
}

const FIXTURE_SLUG = 'mso';

/**
 * Resolve a project from the URL, or return null because this user may not have
 * it.
 *
 * The access check is a query, not an `if`. The slug is looked up through a
 * client carrying the **user's** JWT, so row-level security decides whether the
 * row exists for them — the database answers "may you see this project" rather
 * than the application deciding and hoping its filter was right. A missing
 * project and a forbidden one are indistinguishable from here, which is also
 * what we want: telling someone a slug exists but is not theirs is a small leak
 * of who else is a customer.
 *
 * Callers treat null as `notFound()`.
 */
export async function projectContext(slug: string): Promise<ProjectContext | null> {
  const url = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];

  if (!url || !serviceKey || !anonKey) {
    // No database: the fixture project, which exists for exactly one slug so a
    // stray URL does not silently render someone else's demo data.
    if (slug !== FIXTURE_SLUG) return null;
    return {
      slug,
      projectId: FIXTURE_SLUG,
      session: null,
      data: fixtureDataSource,
      mutations: fixtureMutations,
      isLive: false,
    };
  }

  const session = await resolveSession(url, anonKey);
  if (session === null) return null;

  const scoped = userScopedClient(url, anonKey, session.accessToken);
  const { data: project } = await scoped
    .from('projects')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (project === null) return null;
  const projectId = String(project['id']);

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    slug,
    projectId,
    session,
    // Reads run under the user's own rights, so a filter this code forgets is
    // caught by the database rather than by nobody.
    data: createSupabaseData(scoped, projectId),
    // Writes need the service role: several tables carry only a select policy,
    // because a job rather than a browser is what normally writes them. They
    // are safe because `projectId` above was verified through RLS first.
    mutations: createSupabaseMutations(
      service,
      projectId,
      githubConfigFromEnv(),
      shopifyConfigFromEnv(),
    ),
    isLive: true,
  };
}

async function resolveSession(url: string, anonKey: string): Promise<Session | null> {
  const devUser = process.env['SEARCHPREX_DEV_USER_ID'];
  if (devUser !== undefined && devUser !== '') {
    // A single-tenant or local deployment with no sign-in. Reads then run with
    // no JWT, so RLS sees no user and the service role is what makes them work
    // — acceptable only because there is one tenant.
    return { userId: devUser, accessToken: null };
  }

  const source = createSupabaseSessionSource(url, anonKey);
  return source.resolve({ headers: await headers() });
}

function userScopedClient(
  url: string,
  anonKey: string,
  accessToken: string | null,
): SupabaseClient {
  if (accessToken === null) {
    const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? anonKey;
    return createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
