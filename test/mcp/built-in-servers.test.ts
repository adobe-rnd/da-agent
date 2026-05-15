import { describe, it, expect } from 'vitest';
import { getBuiltInMcpServers } from '../../src/mcp/built-in-servers.js';

function envWith(overrides?: Record<string, unknown>): Env {
  return { GOVERNANCE_AGENT_URL: 'https://gov.example.com/mcp/', ...overrides } as unknown as Env;
}

describe('getBuiltInMcpServers', () => {
  it('returns governance-agent when GOVERNANCE_AGENT_URL is set', () => {
    const servers = getBuiltInMcpServers(envWith());
    expect(servers).toHaveProperty('governance-agent');
    expect(servers['governance-agent'].url).toBe('https://gov.example.com/mcp/');
  });

  it('returns empty object when GOVERNANCE_AGENT_URL is unset', () => {
    const servers = getBuiltInMcpServers(envWith({ GOVERNANCE_AGENT_URL: undefined }));
    expect(Object.keys(servers)).toHaveLength(0);
  });

  it('sets sendImsToken to true', () => {
    const servers = getBuiltInMcpServers(envWith());
    expect(servers['governance-agent'].sendImsToken).toBe(true);
  });

  it('includes instructions referencing Live Preview URL', () => {
    const servers = getBuiltInMcpServers(envWith());
    expect(servers['governance-agent'].instructions).toContain('Live Preview URL');
  });

  it('uses the URL from env verbatim', () => {
    const servers = getBuiltInMcpServers(
      envWith({ GOVERNANCE_AGENT_URL: 'http://localhost:8000/mcp/' }),
    );
    expect(servers['governance-agent'].url).toBe('http://localhost:8000/mcp/');
  });
});
