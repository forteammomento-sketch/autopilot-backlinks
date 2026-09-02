import { EngineError, kindForStatus } from '../engines/errors.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenEndpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Exchanges a refresh token for access tokens, and holds one until it expires.
 *
 * Refresh tokens are long-lived credentials for someone's Search Console. They
 * are never logged, never put in a URL, and never included in an error message
 * — an exception that carried one would end up in a log aggregator, which is
 * how a credential leaks without anyone doing anything wrong.
 */
export class GoogleTokenSource {
  #config: OAuthConfig;
  #fetch: typeof fetch;
  #token: string | null = null;
  #expiresAt = 0;

  constructor(config: OAuthConfig) {
    for (const [name, value] of Object.entries({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    })) {
      if (value.trim() === '') {
        throw new EngineError('auth', 'gsc', `${name} is empty`);
      }
    }
    this.#config = config;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async accessToken(now = Date.now()): Promise<string> {
    // Refresh a minute early: a token that expires mid-request fails the whole
    // page of results rather than one call.
    if (this.#token !== null && now < this.#expiresAt - 60_000) return this.#token;

    const response = await this.#fetch(this.#config.tokenEndpoint ?? TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        refresh_token: this.#config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      // Google echoes an error description that can quote the request. Only the
      // status is surfaced, so nothing carrying the secret can reach a log.
      throw new EngineError(
        kindForStatus(response.status),
        'gsc',
        `token refresh failed with HTTP ${String(response.status)}`,
        { status: response.status },
      );
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new EngineError('auth', 'gsc', 'token response contained no access_token');
    }

    this.#token = body.access_token;
    this.#expiresAt = now + (body.expires_in ?? 3600) * 1000;
    return this.#token;
  }
}

/** A pre-issued access token, for tests and short-lived scripts. */
export class StaticTokenSource {
  #token: string;
  constructor(token: string) {
    if (token.trim() === '') throw new EngineError('auth', 'gsc', 'access token is empty');
    this.#token = token;
  }
  async accessToken(): Promise<string> {
    return this.#token;
  }
}

export interface TokenSource {
  accessToken(): Promise<string>;
}
