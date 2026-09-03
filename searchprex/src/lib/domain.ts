/**
 * Domain normalisation for citation matching.
 *
 * Citations come back as full URLs. To decide whether a citation belongs to the
 * customer, a competitor, or a third party we compare registrable domains
 * (eTLD+1), so `https://www.smkstore.com/products/x?ref=1` and `smkstore.com`
 * are the same site.
 *
 * This uses a hand-maintained list of multi-part suffixes rather than the full
 * Public Suffix List. It covers the suffixes an English-language commerce
 * project actually hits. Swap in the `psl` package before opening non-English
 * markets — `co.jp`, `com.br` and friends are only partly covered here, and a
 * wrong split silently misattributes a citation.
 */

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.za', 'org.za', 'net.za', 'web.za',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.tr', 'com.sg', 'com.hk',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk',
]);

/** Strip scheme, port, path, query, fragment and a leading `www.`. */
export function hostnameOf(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;

  // Tolerate scheme-less citations — some engines return bare hostnames.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  host = host.toLowerCase().replace(/\.$/, '');
  if (host === '') return null;
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * Registrable domain (eTLD+1). Returns the full hostname when it cannot be
 * reduced — an IP address, `localhost`, or a single-label host.
 */
export function registrableDomain(url: string): string | null {
  const host = hostnameOf(url);
  if (host === null) return null;

  // IPv4 / IPv6 literals have no registrable domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;

  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  const take = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/** True when `url` is served by `domain` or any of its subdomains. */
export function isSameSite(url: string, domain: string): boolean {
  const a = registrableDomain(url);
  const b = registrableDomain(domain);
  return a !== null && b !== null && a === b;
}

/**
 * Canonical form used to deduplicate citations: registrable-domain host plus
 * path, with tracking parameters and a trailing slash removed.
 *
 * Query parameters are dropped entirely except where they carry the page
 * identity (`?p=`, `?id=`, `?q=`), because engines cite the same page with
 * assorted `utm_*` and `ref` values and we do not want three rows for one page.
 */
const IDENTITY_PARAMS = new Set(['p', 'id', 'q', 'v', 'page', 'sku']);

export function canonicalUrl(url: string): string | null {
  const host = hostnameOf(url);
  if (host === null) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim())
    ? url.trim()
    : `https://${url.trim()}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const kept = new URLSearchParams();
  for (const [key, value] of [...parsed.searchParams].sort()) {
    if (IDENTITY_PARAMS.has(key.toLowerCase())) kept.append(key, value);
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const query = kept.toString();
  return `${host}${path}${query === '' ? '' : `?${query}`}`;
}
