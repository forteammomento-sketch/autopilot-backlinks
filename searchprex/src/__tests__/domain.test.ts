import { describe, expect, it } from 'vitest';
import { canonicalUrl, hostnameOf, isSameSite, registrableDomain } from '../lib/domain.js';

describe('hostnameOf', () => {
  it('strips scheme, www, path and query', () => {
    expect(hostnameOf('https://www.smkstore.com/products/x?ref=1')).toBe('smkstore.com');
  });

  it('accepts a bare hostname', () => {
    expect(hostnameOf('smkstore.com')).toBe('smkstore.com');
  });

  it('returns null for junk', () => {
    expect(hostnameOf('')).toBeNull();
    expect(hostnameOf('   ')).toBeNull();
  });
});

describe('registrableDomain', () => {
  it('reduces subdomains to eTLD+1', () => {
    expect(registrableDomain('https://blog.shop.example.com/a')).toBe('example.com');
  });

  it('handles two-part suffixes', () => {
    expect(registrableDomain('https://shop.knives.co.uk')).toBe('knives.co.uk');
    expect(registrableDomain('https://www.store.com.pk/x')).toBe('store.com.pk');
  });

  it('leaves IP literals alone', () => {
    expect(registrableDomain('http://192.168.1.1/x')).toBe('192.168.1.1');
  });
});

describe('isSameSite', () => {
  it('matches across subdomain and scheme differences', () => {
    expect(isSameSite('https://www.smkstore.com/p/1', 'smkstore.com')).toBe(true);
    expect(isSameSite('https://shop.smkstore.com', 'https://smkstore.com/')).toBe(true);
  });

  it('does not match a lookalike domain', () => {
    // The failure that would silently inflate a customer's own numbers.
    expect(isSameSite('https://smkstore.com.evil.net', 'smkstore.com')).toBe(false);
    expect(isSameSite('https://notsmkstore.com', 'smkstore.com')).toBe(false);
  });
});

describe('canonicalUrl', () => {
  it('drops tracking params but keeps identity params', () => {
    expect(canonicalUrl('https://a.com/p?utm_source=x&id=7&ref=y')).toBe('a.com/p?id=7');
  });

  it('collapses trailing slashes so one page is one row', () => {
    expect(canonicalUrl('https://a.com/p/')).toBe(canonicalUrl('https://www.a.com/p'));
  });
});
