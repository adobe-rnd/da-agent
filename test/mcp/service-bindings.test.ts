import { describe, it, expect } from 'vitest';
import { resolveMcpFetcher } from '../../src/mcp/service-bindings.js';

const fakeFetcher = { fetch: () => Promise.resolve(new Response('ok')) } as unknown as Fetcher;

describe('resolveMcpFetcher', () => {
  it('returns the bound fetcher for the CI aem-agentic-plugins host', () => {
    const env = { AEM_AGENTIC_PLUGINS: fakeFetcher } as unknown as Env;
    const result = resolveMcpFetcher(
      'https://aem-agentic-plugins-ci.adobeaem.workers.dev/mcp',
      env,
    );
    expect(result).toBe(fakeFetcher);
  });

  it('returns the bound fetcher for the production aem-agentic-plugins host', () => {
    const env = { AEM_AGENTIC_PLUGINS: fakeFetcher } as unknown as Env;
    const result = resolveMcpFetcher('https://aem-agentic-plugins.adobeaem.workers.dev/mcp', env);
    expect(result).toBe(fakeFetcher);
  });

  it('returns undefined when no binding is present (falls back to global fetch)', () => {
    const env = {} as unknown as Env;
    const result = resolveMcpFetcher(
      'https://aem-agentic-plugins-ci.adobeaem.workers.dev/mcp',
      env,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for an unrelated host even when a binding exists', () => {
    const env = { AEM_AGENTIC_PLUGINS: fakeFetcher } as unknown as Env;
    const result = resolveMcpFetcher('https://mcp.deepwiki.com/mcp', env);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a look-alike host on a different domain', () => {
    const env = { AEM_AGENTIC_PLUGINS: fakeFetcher } as unknown as Env;
    const result = resolveMcpFetcher('https://aem-agentic-plugins.evil.example.com/mcp', env);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an unparseable URL', () => {
    const env = { AEM_AGENTIC_PLUGINS: fakeFetcher } as unknown as Env;
    expect(resolveMcpFetcher('not a url', env)).toBeUndefined();
  });
});
