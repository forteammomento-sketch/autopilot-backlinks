import { GoogleTokenSource } from '@/src/gsc/auth';
import { SearchConsoleClient } from '@/src/gsc/client';

/**
 * A Search Console client from the environment, or null when it is not set up.
 *
 * Null is the normal case for a project that has not connected Search Console.
 * Generation still works from catalogue seeds alone — it is just working from
 * inferred demand rather than measured demand.
 */
export function searchConsoleFromEnv(): SearchConsoleClient | null {
  const siteUrl = process.env['GSC_SITE_URL'];
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!siteUrl || !clientId || !clientSecret || !refreshToken) return null;

  return new SearchConsoleClient({
    siteUrl,
    tokens: new GoogleTokenSource({ clientId, clientSecret, refreshToken }),
  });
}
