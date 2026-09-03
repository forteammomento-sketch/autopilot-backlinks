import { NextResponse } from 'next/server';
import { startAuthorization } from '@/src/oauth/google';
import { googleClientFromEnv } from '@/lib/gsc/connection';

export const dynamic = 'force-dynamic';

const COOKIE_TTL_SECONDS = 600;

/**
 * Begin the Google consent flow.
 *
 * The state and the PKCE verifier are put in httpOnly cookies rather than in a
 * session store: they are short-lived, single-use, and belong to this browser
 * only. `sameSite: 'lax'` is required — `strict` would drop the cookies on the
 * cross-site redirect back from Google, and the callback would then reject
 * every legitimate return as a state mismatch.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const google = googleClientFromEnv();
  if (google === null) {
    return NextResponse.json(
      {
        error:
          'Google is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ' +
          'SEARCHPREX_BASE_URL.',
      },
      { status: 503 },
    );
  }

  const project = new URL(request.url).searchParams.get('project') ?? '';
  const { url, state, codeVerifier } = startAuthorization(google);

  const response = NextResponse.redirect(url);
  const options = {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax' as const,
    path: '/api/oauth/google',
    maxAge: COOKIE_TTL_SECONDS,
  };

  response.cookies.set('sp_oauth_state', state, options);
  response.cookies.set('sp_oauth_verifier', codeVerifier, options);
  response.cookies.set('sp_oauth_project', project, options);

  return response;
}
