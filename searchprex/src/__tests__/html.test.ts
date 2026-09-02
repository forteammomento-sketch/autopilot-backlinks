import { describe, expect, it } from 'vitest';
import {
  bestPassage,
  hasSchemaType,
  hasSnippetSuppression,
  schemaTypes,
  visibleText,
  wordCount,
} from '../lib/html.js';

describe('visibleText', () => {
  it('drops script and style content', () => {
    const html = '<p>Real copy.</p><script>var brand = "SMK Store";</script><style>p{}</style>';
    const text = visibleText(html);
    expect(text).toContain('Real copy.');
    // A brand named inside a script tag must not count as page content.
    expect(text).not.toContain('SMK Store');
  });

  it('keeps block boundaries so paragraphs stay separate', () => {
    expect(visibleText('<p>One</p><p>Two</p>').split('\n')).toEqual(['One', 'Two']);
  });

  it('does not split one paragraph on HTML source newlines', () => {
    // Regression: source line breaks inside a block are formatting, not
    // structure. Splitting on them chopped every real answer into fragments
    // too short to pass the answer-length band, so well-written pages were
    // reported as thin.
    const html = `<p>A barlow knife blade in 1095 carbon steel stays sharp
       for roughly two weeks of daily cutting before it needs
       a strop.</p>`;
    const lines = visibleText(html).split('\n');
    expect(lines).toHaveLength(1);
    expect(wordCount(lines[0]!)).toBe(22);
  });

  it('treats an opening block tag as a boundary too', () => {
    expect(visibleText('<div>One<div>Two').split('\n')).toEqual(['One', 'Two']);
  });

  it('decodes common entities', () => {
    expect(visibleText('<p>Smith&amp;Wesson&nbsp;knives</p>')).toBe('Smith&Wesson knives');
  });
});

describe('schemaTypes', () => {
  it('reads types out of @graph and arrays', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Product","Offer"]}]}
    </script>`;
    expect(schemaTypes(html)).toEqual(['Offer', 'Organization', 'Product']);
    expect(hasSchemaType(html, ['Product'])).toBe(true);
  });

  it('skips a malformed block instead of throwing', () => {
    // Search engines ignore unparseable JSON-LD, so a page with only a broken
    // block genuinely has no schema.
    const html = '<script type="application/ld+json">{ not json }</script>';
    expect(schemaTypes(html)).toEqual([]);
    expect(hasSchemaType(html, ['Product'])).toBe(false);
  });
});

describe('hasSnippetSuppression', () => {
  it('detects nosnippet and max-snippet:0', () => {
    expect(hasSnippetSuppression('<meta name="robots" content="index, nosnippet">')).toBe(true);
    expect(hasSnippetSuppression('<meta name="googlebot" content="max-snippet:0">')).toBe(true);
  });

  it('does not fire on an ordinary robots meta', () => {
    expect(hasSnippetSuppression('<meta name="robots" content="index, follow">')).toBe(false);
    expect(hasSnippetSuppression('<meta name="robots" content="max-snippet:-1">')).toBe(false);
  });
});

describe('bestPassage', () => {
  const prompt = 'how long does a barlow knife blade stay sharp';

  it('finds the paragraph that overlaps the prompt', () => {
    const html = `
      <p>We ship worldwide from Michigan every weekday.</p>
      <p>A barlow knife blade in 1095 carbon steel holds a working edge for roughly
         two weeks of daily cutting before it needs a strop, and about six weeks
         before a full sharpen.</p>`;
    const passage = bestPassage(html, prompt)!;
    expect(passage.text).toContain('holds a working edge');
    expect(passage.overlap).toBeGreaterThan(0.4);
  });

  it('reports the word count of a wall of text so the detector can reject it', () => {
    const wall = `barlow knife blade sharp ${'filler words here '.repeat(60)}`;
    const passage = bestPassage(`<p>${wall}</p>`, prompt)!;
    expect(passage.words).toBeGreaterThan(90);
  });

  it('returns null when the prompt has no content words', () => {
    expect(bestPassage('<p>anything at all here</p>', 'the and of')).toBeNull();
  });
});

describe('wordCount', () => {
  it('counts nothing for empty input', () => {
    expect(wordCount('   ')).toBe(0);
  });
});
