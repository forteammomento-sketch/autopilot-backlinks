import { describe, expect, it, vi } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import {
  encryptionKeyFromEnv,
  openToken,
  sealToken,
  tokenFingerprint,
} from '../oauth/crypto.js';
import { GSC_SCOPE, exchangeCode, startAuthorization, stateMatches } from '../oauth/google.js';

const KEY = randomBytes(32);

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://app.searchprex.com/api/oauth/google/callback',
};

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('token encryption', () => {
  it('round-trips a refresh token', () => {
    const sealed = sealToken('1//refresh-abc', KEY);
    expect(sealed).not.toContain('refresh-abc');
    expect(openToken(sealed, KEY)).toBe('1//refresh-abc');
  });

  it('produces a different ciphertext each time', () => {
    // A fresh IV per seal, so identical tokens are not identifiable as such
    // from the stored column.
    expect(sealToken('same', KEY)).not.toBe(sealToken('same', KEY));
  });

  it('refuses to open with the wrong key', () => {
    expect(() => openToken(sealToken('x', KEY), randomBytes(32))).toThrow();
  });

  it('refuses to open a tampered ciphertext', () => {
    // GCM authenticates: a modified value fails rather than decrypting to
    // something an attacker chose.
    const sealed = Buffer.from(sealToken('secret', KEY), 'base64');
    sealed[sealed.length - 1] = (sealed.at(-1) ?? 0) ^ 0xff;
    expect(() => openToken(sealed.toString('base64'), KEY)).toThrow();
  });

  it('rejects a short key rather than stretching it', () => {
    // Padding a weak key into shape would leave everyone believing tokens are
    // protected when they are not.
    expect(() => encryptionKeyFromEnv('too-short')).toThrow('32 bytes');
    expect(encryptionKeyFromEnv(undefined)).toBeNull();
    expect(encryptionKeyFromEnv(KEY.toString('base64'))!.length).toBe(32);
    expect(encryptionKeyFromEnv(KEY.toString('hex'))!.length).toBe(32);
  });

  it('fingerprints without revealing', () => {
    const fp = tokenFingerprint('1//refresh-abc');
    expect(fp).toHaveLength(12);
    expect('1//refresh-abc').not.toContain(fp);
  });
});

describe('startAuthorization', () => {
  it('asks for a refresh token and forces a fresh grant', () => {
    // Without prompt=consent a returning user gets an access token and no
    // refresh token: the integration looks fine and dies an hour later.
    const start = startAuthorization(config);
    const url = new URL(start.url);

    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('requests only the read-only scope', () => {
    const url = new URL(startAuthorization(config).url);
    expect(url.searchParams.get('scope')).toBe(GSC_SCOPE);
    expect(url.searchParams.get('scope')).toContain('readonly');
  });

  it('sends a correct S256 PKCE challenge', () => {
    const start = startAuthorization(config);
    const url = new URL(start.url);
    const expected = createHash('sha256').update(start.codeVerifier).digest('base64url');

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(expected);
  });

  it('never repeats a state or a verifier', () => {
    const a = startAuthorization(config);
    const b = startAuthorization(config);
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it('does not put the client secret in the consent URL', () => {
    expect(startAuthorization(config).url).not.toContain('client-secret');
  });
});

describe('stateMatches', () => {
  it('rejects a missing, empty or different state', () => {
    expect(stateMatches(undefined, 'x')).toBe(false);
    expect(stateMatches('x', null)).toBe(false);
    expect(stateMatches('', '')).toBe(false);
    expect(stateMatches('abc', 'abd')).toBe(false);
    expect(stateMatches('abc', 'abc')).toBe(true);
  });
});

describe('exchangeCode', () => {
  const good = {
    access_token: 'ya29.access',
    refresh_token: '1//refresh',
    expires_in: 3599,
    scope: GSC_SCOPE,
  };

  it('exchanges a code and returns both tokens', async () => {
    const result = await exchangeCode(
      { ...config, fetchImpl: vi.fn(async () => tokenResponse(good)) as never },
      { code: 'c', error: null, receivedState: 's', expectedState: 's', codeVerifier: 'v' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.refreshToken).toBe('1//refresh');
      expect(result.tokens.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it('refuses a callback whose state does not match', async () => {
    // Otherwise an attacker can walk a signed-in admin through their own
    // consent screen and have the project connected to the wrong account.
    const fetchImpl = vi.fn();
    const result = await exchangeCode(
      { ...config, fetchImpl: fetchImpl as never },
      { code: 'c', error: null, receivedState: 'attacker', expectedState: 'ours', codeVerifier: 'v' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('state_mismatch');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a denied consent without calling Google', async () => {
    const fetchImpl = vi.fn();
    const result = await exchangeCode(
      { ...config, fetchImpl: fetchImpl as never },
      { code: null, error: 'access_denied', receivedState: 's', expectedState: 's', codeVerifier: 'v' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('denied');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the PKCE verifier', async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => tokenResponse(good),
    );
    await exchangeCode(
      { ...config, fetchImpl: fetchImpl as never },
      { code: 'c', error: null, receivedState: 's', expectedState: 's', codeVerifier: 'verifier-123' },
    );

    const body = String(fetchImpl.mock.calls[0]![1]!.body);
    expect(body).toContain('code_verifier=verifier-123');
    expect(body).toContain('grant_type=authorization_code');
  });

  it('says what to do when Google issues no refresh token', async () => {
    const result = await exchangeCode(
      {
        ...config,
        fetchImpl: vi.fn(async () => tokenResponse({ access_token: 'a', expires_in: 3599 })) as never,
      },
      { code: 'c', error: null, receivedState: 's', expectedState: 's', codeVerifier: 'v' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_refresh_token');
      expect(result.message).toContain('myaccount.google.com/permissions');
    }
  });

  it('never leaks the client secret through an error', async () => {
    // Google's error body quotes the request, which carries the secret.
    const result = await exchangeCode(
      {
        ...config,
        fetchImpl: vi.fn(async () =>
          tokenResponse({ error: 'invalid_client', error_description: 'secret client-secret' }, 401),
        ) as never,
      },
      { code: 'c', error: null, receivedState: 's', expectedState: 's', codeVerifier: 'v' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('client-secret');
      expect(result.message).toContain('401');
    }
  });
});
