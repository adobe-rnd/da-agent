import { describe, it, expect } from 'vitest';
import { parseTrustedDomains, isUrlTrustedForToken } from '../../src/mcp/token-allowlist.js';

describe('parseTrustedDomains', () => {
  it('returns default patterns when env value is undefined', () => {
    expect(parseTrustedDomains()).toEqual(['*.adobe.io']);
    expect(parseTrustedDomains(undefined)).toEqual(['*.adobe.io']);
  });

  it('returns empty array when env value is explicitly empty (trust nothing)', () => {
    expect(parseTrustedDomains('')).toEqual([]);
    expect(parseTrustedDomains(' , , ')).toEqual([]);
  });

  it('parses comma-separated patterns', () => {
    expect(parseTrustedDomains('*.adobe.io, *.corp.adobe.net')).toEqual([
      '*.adobe.io',
      '*.corp.adobe.net',
    ]);
  });

  it('lowercases patterns', () => {
    expect(parseTrustedDomains('*.Adobe.IO')).toEqual(['*.adobe.io']);
  });
});

describe('isUrlTrustedForToken', () => {
  const patterns = ['*.adobe.io', '*.corp.ethos340-prod-va6.ethos.adobe.net', 'exact.example.com'];

  it('matches wildcard subdomain patterns', () => {
    expect(isUrlTrustedForToken('https://firefly.adobe.io/mcp', patterns)).toBe(true);
    expect(isUrlTrustedForToken('https://deep.nested.adobe.io/path', patterns)).toBe(true);
  });

  it('matches the bare domain of a wildcard pattern', () => {
    expect(isUrlTrustedForToken('https://adobe.io/mcp', patterns)).toBe(true);
  });

  it('matches exact hostname patterns', () => {
    expect(isUrlTrustedForToken('https://exact.example.com/api', patterns)).toBe(true);
  });

  it('rejects untrusted domains', () => {
    expect(isUrlTrustedForToken('https://evil.com/steal', patterns)).toBe(false);
    expect(isUrlTrustedForToken('https://not-adobe.io/mcp', patterns)).toBe(false);
    expect(isUrlTrustedForToken('https://fakeadobe.io/mcp', patterns)).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isUrlTrustedForToken('not a url', patterns)).toBe(false);
    expect(isUrlTrustedForToken('', patterns)).toBe(false);
  });

  it('matches complex corp domain patterns', () => {
    expect(
      isUrlTrustedForToken(
        'https://na1-merchandising-mcp-server.corp.ethos340-prod-va6.ethos.adobe.net/mcp',
        patterns,
      ),
    ).toBe(true);
  });

  it('is case-insensitive on hostnames', () => {
    expect(isUrlTrustedForToken('https://Firefly.Adobe.IO/mcp', patterns)).toBe(true);
  });
});
