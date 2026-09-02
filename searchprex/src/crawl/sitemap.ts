/**
 * Sitemap parsing.
 *
 * Regex rather than an XML parser: sitemaps are machine-generated, flat, and
 * frequently large. What we need from them is a list of URLs and whether the
 * document is an index pointing at more sitemaps.
 */

export interface SitemapContents {
  /** True when this document is a sitemapindex rather than a urlset. */
  isIndex: boolean;
  /** Page URLs for a urlset, or child sitemap URLs for a sitemapindex. */
  urls: string[];
  /** lastmod per URL, when present, keyed by URL. */
  lastmod: Map<string, string>;
}

export function parseSitemap(xml: string): SitemapContents {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const urls: string[] = [];
  const lastmod = new Map<string, string>();

  const entryPattern = isIndex
    ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi
    : /<url\b[^>]*>([\s\S]*?)<\/url>/gi;

  for (const entry of xml.matchAll(entryPattern)) {
    const block = entry[1] ?? '';
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(block)?.[1]?.trim();
    if (loc === undefined || loc === '') continue;

    const url = decodeXmlEntities(loc);
    urls.push(url);

    const modified = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1]?.trim();
    if (modified !== undefined && modified !== '') lastmod.set(url, modified);
  }

  // Some sitemaps omit the wrapper elements entirely; fall back to bare <loc>.
  if (urls.length === 0) {
    for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
      const loc = match[1]?.trim();
      if (loc !== undefined && loc !== '') urls.push(decodeXmlEntities(loc));
    }
  }

  return { isIndex, urls, lastmod };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
