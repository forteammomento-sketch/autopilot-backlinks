import type { SupabaseClient } from '@supabase/supabase-js';
import { openToken, sealToken, encryptionKeyFromEnv } from '@/src/oauth/crypto';
import { GoogleTokenSource } from '@/src/gsc/auth';
import { SearchConsoleClient } from '@/src/gsc/client';

export const PROVIDER = 'google_search_console';

export interface ConnectionSummary {
  siteUrl: string | null;
  accountEmail: string | null;
  connectedAt: string;
}

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleClientFromEnv(): GoogleClientConfig | null {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const baseUrl = process.env['SEARCHPREX_BASE_URL'];
  if (!clientId || !clientSecret || !baseUrl) return null;

  return {
    clientId,
    clientSecret,
    // Google matches this string exactly against the registered redirect URI,
    // trailing slash and all, so it is derived from one configured base rather
    // than from the incoming request — a request-derived URI changes with the
    // host header and stops matching.
    redirectUri: `${baseUrl.replace(/\/+$/, '')}/api/oauth/google/callback`,
  };
}

export function encryptionKey(): Buffer | null {
  return encryptionKeyFromEnv(process.env['SEARCHPREX_ENCRYPTION_KEY']);
}

export async function saveConnection(
  client: SupabaseClient,
  projectId: string,
  args: { refreshToken: string; scope: string; accountEmail?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = encryptionKey();
  if (key === null) {
    // Refusing is the right answer. Storing the token in plaintext "for now"
    // is how a permanent credential ends up in a backup nobody remembers.
    return {
      ok: false,
      message:
        'SEARCHPREX_ENCRYPTION_KEY is not set, so the refresh token cannot be stored ' +
        'safely. Generate one with `openssl rand -base64 32`.',
    };
  }

  const { error } = await client.from('connections').upsert(
    {
      project_id: projectId,
      provider: PROVIDER,
      refresh_token_sealed: sealToken(args.refreshToken, key),
      scope: args.scope,
      ...(args.accountEmail === undefined ? {} : { account_email: args.accountEmail }),
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,provider' },
  );

  return error === null ? { ok: true } : { ok: false, message: error.message };
}

export async function readConnection(
  client: SupabaseClient,
  projectId: string,
): Promise<ConnectionSummary | null> {
  // Reads the view, which has no sealed token column: nothing that renders a
  // page can accidentally serialise the credential into the response.
  const { data } = await client
    .from('v_connections')
    .select('site_url, account_email, connected_at')
    .eq('project_id', projectId)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (data === null) return null;
  return {
    siteUrl: data['site_url'] === null ? null : String(data['site_url']),
    accountEmail: data['account_email'] === null ? null : String(data['account_email']),
    connectedAt: String(data['connected_at']),
  };
}

export async function setConnectionSite(
  client: SupabaseClient,
  projectId: string,
  siteUrl: string,
): Promise<void> {
  await client
    .from('connections')
    .update({ site_url: siteUrl })
    .eq('project_id', projectId)
    .eq('provider', PROVIDER);
}

export async function deleteConnection(
  client: SupabaseClient,
  projectId: string,
): Promise<void> {
  await client.from('connections').delete().eq('project_id', projectId).eq('provider', PROVIDER);
}

/**
 * A Search Console client for a stored connection.
 *
 * The sealed token is opened here and handed straight to the token source; it
 * is never returned to a caller, so there is no path by which it reaches a
 * page, a log line or an error message.
 */
export async function searchConsoleForProject(
  client: SupabaseClient,
  projectId: string,
  siteUrlOverride?: string,
): Promise<SearchConsoleClient | null> {
  const key = encryptionKey();
  const google = googleClientFromEnv();
  if (key === null || google === null) return null;

  const { data } = await client
    .from('connections')
    .select('refresh_token_sealed, site_url')
    .eq('project_id', projectId)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (data === null) return null;

  const siteUrl = siteUrlOverride ?? (data['site_url'] === null ? '' : String(data['site_url']));
  if (siteUrl === '') return null;

  return new SearchConsoleClient({
    siteUrl,
    tokens: new GoogleTokenSource({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      refreshToken: openToken(String(data['refresh_token_sealed']), key),
    }),
  });
}

/** The connected account's properties, for the picker. */
export async function listProperties(
  client: SupabaseClient,
  projectId: string,
): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const key = encryptionKey();
  const google = googleClientFromEnv();
  if (key === null || google === null) return [];

  const { data } = await client
    .from('connections')
    .select('refresh_token_sealed')
    .eq('project_id', projectId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (data === null) return [];

  // Any siteUrl works for listing; the endpoint is account-scoped.
  const gsc = new SearchConsoleClient({
    siteUrl: 'https://example.com/',
    tokens: new GoogleTokenSource({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      refreshToken: openToken(String(data['refresh_token_sealed']), key),
    }),
  });

  return gsc.sites();
}
