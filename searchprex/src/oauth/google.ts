import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Read-only. Search Console offers a read-write scope; this product only ever
 * reads query data, and asking for more access than a feature needs is how a
 * breach turns from an information leak into someone editing a customer's
 * property.
 */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Must match a redirect URI registered on the Google client, exactly. */
  redirectUri: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  fetchImpl?: typeof fetch;
}

export interface AuthorizationStart {
  url: string;
  /** Round-tripped through Google and checked on return. */
  state: string;
  /** Held only by this browser; proves the callback came from the same client. */
  codeVerifier: string;
}

/**
 * Build the consent URL, with the two parameters this flow is useless without.
 *
 * `access_type=offline` asks for a refresh token at all. `prompt=consent`
 * forces Google to issue a *new* one even when the user has granted before —
 * without it, a second connection returns an access token and no refresh token,
 * the integration appears to work, and then stops the moment the access token
 * expires an hour later. It is the single most common way a Google integration
 * ships broken.
 */
export function startAuthorization(config: GoogleOAuthConfig): AuthorizationStart {
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GSC_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: base64Url(createHash('sha256').update(codeVerifier).digest()),
    code_challenge_method: 'S256',
  });

  return {
    url: `${config.authEndpoint ?? AUTH_ENDPOINT}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export type ExchangeResult =
  | { ok: true; tokens: GoogleTokens }
  | { ok: false; reason: 'state_mismatch' | 'no_refresh_token' | 'denied' | 'exchange_failed'; message: string };

/**
 * Compare the returned `state` with the one we issued, in constant time.
 *
 * Without this check the callback accepts any code anyone can get it to load,
 * which lets an attacker walk a signed-in admin through a consent screen for
 * the attacker's own Google account and have the victim's project quietly
 * connected to it. The tool would then read the wrong Search Console and the
 * customer would have no reason to suspect why the data looked odd.
 */
export function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (expected === undefined || expected === '' || received === null || received === '') {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function exchangeCode(
  config: GoogleOAuthConfig,
  params: {
    code: string | null;
    error: string | null;
    receivedState: string | null;
    expectedState: string | undefined;
    codeVerifier: string | undefined;
  },
): Promise<ExchangeResult> {
  if (params.error !== null && params.error !== '') {
    return { ok: false, reason: 'denied', message: `Google returned "${params.error}".` };
  }
  if (!stateMatches(params.expectedState, params.receivedState)) {
    return {
      ok: false,
      reason: 'state_mismatch',
      message: 'The consent response did not match this browser session. Start again.',
    };
  }
  if (params.code === null || params.code === '' || params.codeVerifier === undefined) {
    return { ok: false, reason: 'exchange_failed', message: 'The callback carried no code.' };
  }

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(config.tokenEndpoint ?? TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    // Google's error body quotes the request, which carries the client secret.
    // Only the status is surfaced so nothing sensitive reaches a log.
    return {
      ok: false,
      reason: 'exchange_failed',
      message: `Token exchange failed with HTTP ${String(response.status)}.`,
    };
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (typeof body.refresh_token !== 'string' || body.refresh_token === '') {
    // With prompt=consent this should not happen, so it means something is
    // wrong with the client configuration rather than with the user.
    return {
      ok: false,
      reason: 'no_refresh_token',
      message:
        'Google issued no refresh token. Remove this app at ' +
        'myaccount.google.com/permissions and connect again.',
    };
  }

  return {
    ok: true,
    tokens: {
      accessToken: String(body.access_token ?? ''),
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      scope: String(body.scope ?? GSC_SCOPE),
    },
  };
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}
