import { isSameSite } from '../lib/domain.js';

/**
 * Internal link extraction.
 *
 * Used for two things: discovering pages when a site has no usable sitemap,
 * and counting inbound internal links so the detector can spot orphans.
 */

/** Absolute, same-site hrefs found in the page, deduplicated and normalised. */
export function internalLinks(html: string, pageUrl: string, siteDomain: string): string[] {
  const out = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1];
    if (href === undefined) continue;

    const trimmed = href.trim();
    if (trimmed === '' || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(trimmed)) continue;

    let resolved: URL;
    try {
      resolved = new URL(trimmed, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    if (!isSameSite(resolved.href, siteDomain)) continue;

    // A fragment points at the same document, so it is not a separate page and
    // must not inflate the inbound-link count.
    resolved.hash = '';
    out.add(resolved.href);
  }

  return [...out];
}

/** `<link rel="canonical">` target, resolved against the page URL. */
export function canonicalOf(html: string, pageUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?canonical["']?/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href === undefined) continue;
    try {
      return new URL(href.trim(), pageUrl).href;
    } catch {
      return null;
    }
  }
  return null;
}

export function titleOf(html: string): string | null {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  return title === undefined || title === '' ? null : title;
}

export function firstHeadingOf(html: string): string | null {
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (heading === undefined) return null;
  const text = heading.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}
