import { describe, it, expect } from 'vitest';
import { CORS_HEADERS, extractImsUserId } from '../src/auth.js';

describe('CORS_HEADERS', () => {
  it('allows all origins for cross-domain chat requests', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
  });

  it('permits GET and POST methods', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('POST');
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('GET');
  });

  it('allows Authorization header for IMS token pass-through', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization');
  });
});

describe('extractImsUserId', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'none' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.sig`;
  }

  it('returns undefined for undefined token', () => {
    expect(extractImsUserId(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractImsUserId('')).toBeUndefined();
  });

  it('extracts user_id from JWT payload', () => {
    const token = makeJwt({ user_id: 'uid-123' });
    expect(extractImsUserId(token)).toBe('uid-123');
  });

  it('falls back to sub when user_id is absent', () => {
    const token = makeJwt({ sub: 'sub-456' });
    expect(extractImsUserId(token)).toBe('sub-456');
  });

  it('prefers user_id over sub', () => {
    const token = makeJwt({ user_id: 'uid-123', sub: 'sub-456' });
    expect(extractImsUserId(token)).toBe('uid-123');
  });

  it('returns undefined for malformed token', () => {
    expect(extractImsUserId('not-a-jwt')).toBeUndefined();
  });

  it('returns undefined for token with invalid base64 payload', () => {
    expect(extractImsUserId('header.!!!invalid!!!.sig')).toBeUndefined();
  });
});
