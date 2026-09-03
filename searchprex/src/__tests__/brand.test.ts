import { describe, expect, it } from 'vitest';
import { aliasesForProject, findBrandMention } from '../lib/brand.js';

describe('findBrandMention', () => {
  it('finds a whole-word match regardless of case', () => {
    const m = findBrandMention('I would look at smk store for that.', ['SMK Store']);
    expect(m.mentioned).toBe(true);
    expect(m.firstOffset).toBe(16);
  });

  it('does not match inside a longer word', () => {
    // The false positive that would report visibility the customer does not have.
    expect(findBrandMention('Foxtrot Knives is popular.', ['Fox']).mentioned).toBe(false);
    expect(findBrandMention('SMKT Ltd sells them.', ['SMK']).mentioned).toBe(false);
  });

  it('tolerates possessives and punctuation', () => {
    expect(findBrandMention("SMK Store's range is wide.", ['SMK Store']).mentioned).toBe(true);
    expect(findBrandMention('Try SMK Store, then compare.', ['SMK Store']).mentioned).toBe(true);
  });

  it('tolerates irregular whitespace between alias words', () => {
    expect(findBrandMention('the SMK  Store listing', ['SMK Store']).mentioned).toBe(true);
    expect(findBrandMention('the SMK\nStore listing', ['SMK Store']).mentioned).toBe(true);
  });

  it('prefers the most specific alias', () => {
    const m = findBrandMention('SMK Store stocks it.', ['SMK', 'SMK Store']);
    expect(m.matchedAlias).toBe('SMK Store');
  });

  it('reports no match when there are no usable aliases', () => {
    expect(findBrandMention('anything', ['', '   ']).mentioned).toBe(false);
  });
});

describe('aliasesForProject', () => {
  it('derives an alias from the domain label', () => {
    expect(aliasesForProject('https://www.smkstore.com/', [])).toContain('smkstore');
  });

  it('keeps configured names and deduplicates', () => {
    const aliases = aliasesForProject('smkstore.com', ['SMK Store', 'smkstore']);
    expect(aliases).toEqual(['SMK Store', 'smkstore']);
  });
});
