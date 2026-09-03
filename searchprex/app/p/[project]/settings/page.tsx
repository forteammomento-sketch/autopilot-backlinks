import { notFound } from 'next/navigation';
import { projectContext } from '@/lib/auth/project';
import { SubmitButton } from '@/lib/ui/submit-button';
import { shortDate } from '@/lib/ui/bits';
import { chooseProperty, disconnectGoogle } from './server-actions';

const OAUTH_MESSAGE: Record<string, { tone: string; title: string; body: string }> = {
  connected: {
    tone: 'banner-good',
    title: 'Search Console connected',
    body: 'Pick the property this project should read below.',
  },
  denied: {
    tone: 'banner-warn',
    title: 'Consent was declined',
    body: 'Nothing was stored. Prompts will keep seeding from the catalogue alone.',
  },
  state_mismatch: {
    tone: 'banner-bad',
    title: 'That response did not match this browser',
    body:
      'The consent reply could not be tied to the request that started it, so it was ' +
      'rejected. Start again from this page.',
  },
  no_refresh_token: {
    tone: 'banner-bad',
    title: 'Google issued no refresh token',
    body:
      'Remove Searchprex at myaccount.google.com/permissions and connect again, so Google ' +
      'issues a fresh grant.',
  },
  store_failed: {
    tone: 'banner-bad',
    title: 'The credential could not be stored',
    body:
      'SEARCHPREX_ENCRYPTION_KEY is probably missing. Nothing was saved — a refresh token ' +
      'is never written in plaintext.',
  },
  unconfigured: {
    tone: 'banner-warn',
    title: 'Google is not configured',
    body: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SEARCHPREX_BASE_URL.',
  },
  no_database: {
    tone: 'banner-bad',
    title: 'No database to store the connection',
    body: 'Supabase is not configured, so there is nowhere to keep the credential.',
  },
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project } = await params;
  const ctx = await projectContext(project);
  if (ctx === null) notFound();

  const query = await searchParams;
  const outcome = typeof query['oauth'] === 'string' ? query['oauth'] : null;

  const [summary, connection, properties] = await Promise.all([
    ctx.data.project(),
    ctx.data.connection(),
    ctx.data.connection().then((c) => (c === null ? [] : ctx.data.properties())),
  ]);
  if (summary === null) return null;

  const notice = outcome === null ? null : OAUTH_MESSAGE[outcome];

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p>
          Connections this project uses. Search Console is optional — without it prompts are
          seeded from the catalogue alone, which is inferred demand rather than measured.
        </p>
      </div>

      {ctx.isLive ? null : (
        <p className="envnote">
          Fixture data — Supabase is not configured, so no connection can be stored.
        </p>
      )}

      {notice === undefined || notice === null ? null : (
        <div className={`banner ${notice.tone}`}>
          <h3>{notice.title}</h3>
          <p>{notice.body}</p>
        </div>
      )}

      <h2 className="section">Google Search Console</h2>

      {connection === null ? (
        <div className="card">
          <p className="note" style={{ marginTop: 0 }}>
            Not connected. Connecting asks Google for <strong>read-only</strong> access to
            your Search Console — this product never writes to it. The credential is
            encrypted before it is stored, and you can revoke it here or from your Google
            account at any time.
          </p>
          <p style={{ marginBottom: 0 }}>
            <a className="btn btn-primary" href={`/api/oauth/google/start?project=${project}`}>
              Connect Google Search Console
            </a>
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="note" style={{ marginTop: 0 }}>
            Connected {shortDate(connection.connectedAt)}
            {connection.accountEmail === null ? '' : ` as ${connection.accountEmail}`}.{' '}
            {connection.siteUrl === null ? (
              <strong>No property chosen yet — pick one below.</strong>
            ) : (
              <>
                Reading <code>{connection.siteUrl}</code>.
              </>
            )}
          </p>

          {properties.length === 0 ? (
            <p className="note">
              No properties came back. The grant may have been revoked in Google — reconnect
              to fix it.
            </p>
          ) : (
            <div className="table-wrap" style={{ margin: '12px 0' }}>
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Access</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {properties.map((property) => (
                    <tr key={property.siteUrl}>
                      <td>
                        <code>{property.siteUrl}</code>
                        {property.siteUrl.startsWith('sc-domain:') ? (
                          <div className="gate">
                            domain property — covers every subdomain and protocol
                          </div>
                        ) : (
                          <div className="gate">
                            URL-prefix property — only this exact prefix
                          </div>
                        )}
                      </td>
                      <td className="gate">{property.permissionLevel}</td>
                      <td>
                        {connection.siteUrl === property.siteUrl ? (
                          <span className="pill pill-approved">in use</span>
                        ) : (
                          <form action={chooseProperty}>
                            <input type="hidden" name="project" value={project} />
                            <input type="hidden" name="siteUrl" value={property.siteUrl} />
                            <SubmitButton className="btn" pendingLabel="Selecting…">
                              Use this
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="note">
            A domain property and a URL-prefix property for the same site are different
            properties holding different data. Picking the wrong one returns an empty
            result that reads as &ldquo;this site has no queries&rdquo;.
          </p>

          <form action={disconnectGoogle}>
            <input type="hidden" name="project" value={project} />
            <SubmitButton className="btn btn-quiet" pendingLabel="Disconnecting…">
              Disconnect
            </SubmitButton>
          </form>
        </div>
      )}
    </>
  );
}
