import { NextResponse } from 'next/server';
import { exchangeCode } from '@/src/oauth/google';
import { createSupabaseClient } from '@/lib/data/supabase';
import { googleClientFromEnv, saveConnection } from '@/lib/gsc/connection';
import { projectContext } from '@/lib/auth/project';

export const dynamic = 'force-dynamic';

/**
 * Finish the Google consent flow.
 *
 * The one-time cookies are cleared on every path, success or failure. Leaving a
 * used state behind turns a single-use value into a replayable one.
 *
 * Nothing about the tokens reaches the redirect: the outcome is a short code in
 * the query string, because a URL ends up in browser history, in the referrer
 * of the next request, and in any access log between here and the user.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const google = googleClientFromEnv();
  const url = new URL(request.url);
  const cookies = request.headers.get('cookie') ?? '';

  const project = readCookie(cookies, 'sp_oauth_project') ?? '';
  const settings = `/p/${project === '' ? 'mso' : project}/settings`;

  if (google === null) return finish(settings, 'unconfigured');

  const result = await exchangeCode(google, {
    code: url.searchParams.get('code'),
    error: url.searchParams.get('error'),
    receivedState: url.searchParams.get('state'),
    expectedState: readCookie(cookies, 'sp_oauth_state'),
    codeVerifier: readCookie(cookies, 'sp_oauth_verifier'),
  });

  if (!result.ok) return finish(settings, result.reason);

  const client = createSupabaseClient();
  if (client === null) return finish(settings, 'no_database');

  // Re-resolved rather than trusted from the cookie: between starting the flow
  // and returning from Google the session can have changed, and the credential
  // must land on a project this request may still write to.
  const ctx = await projectContext(project);
  if (ctx === null) return finish(settings, 'unconfigured');

  const saved = await saveConnection(client, ctx.projectId, {
    refreshToken: result.tokens.refreshToken,
    scope: result.tokens.scope,
  });

  return finish(settings, saved.ok ? 'connected' : 'store_failed');
}

function finish(settings: string, outcome: string): NextResponse {
  const base = process.env['SEARCHPREX_BASE_URL'] ?? 'http://localhost:3000';
  const response = NextResponse.redirect(
    `${base.replace(/\/+$/, '')}${settings}?oauth=${encodeURIComponent(outcome)}`,
  );

  for (const name of ['sp_oauth_state', 'sp_oauth_verifier', 'sp_oauth_project']) {
    response.cookies.set(name, '', { path: '/api/oauth/google', maxAge: 0 });
  }
  return response;
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
