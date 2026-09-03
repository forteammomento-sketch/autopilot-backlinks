import { createClient } from '@supabase/supabase-js';
import type { Session, SessionSource } from '@/lib/auth/types';

/**
 * A session from a Supabase auth JWT.
 *
 * The token is taken from an `Authorization: Bearer` header, or from the
 * `sb-<ref>-auth-token` cookie Supabase sets. It is then **verified with
 * Supabase** rather than decoded here: a JWT read without checking its
 * signature is a claim anybody can write, and treating one as a user identity
 * is the whole vulnerability.
 */
export function createSupabaseSessionSource(url: string, anonKey: string): SessionSource {
  return {
    async resolve(request): Promise<Session | null> {
      const token = readToken(request.headers);
      if (token === null) return null;

      const client = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data, error } = await client.auth.getUser(token);
      if (error !== null || data.user === null) return null;

      return { userId: data.user.id, accessToken: token };
    },
  };
}

function readToken(headers: Headers): string | null {
  const authorization = headers.get('authorization') ?? '';
  if (authorization.startsWith('Bearer ')) {
    const value = authorization.slice(7).trim();
    if (value !== '') return value;
  }

  const cookie = headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    const name = rawName ?? '';
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;

    const raw = decodeURIComponent(rest.join('='));
    const token = parseCookieValue(raw);
    if (token !== null) return token;
  }
  return null;
}

/**
 * Supabase has stored this cookie several ways across versions: raw JSON, a
 * `base64-` prefixed JSON blob, and a bare token. All three are accepted, since
 * failing to parse one silently signs everybody out.
 */
function parseCookieValue(raw: string): string | null {
  let text = raw;
  if (text.startsWith('base64-')) {
    try {
      text = Buffer.from(text.slice(7), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      const holder = Array.isArray(parsed) ? parsed[0] : parsed;
      if (typeof holder === 'string') return holder;
      if (typeof holder === 'object' && holder !== null) {
        const token = (holder as Record<string, unknown>)['access_token'];
        if (typeof token === 'string' && token !== '') return token;
      }
    } catch {
      return null;
    }
    return null;
  }

  return text === '' ? null : text;
}
