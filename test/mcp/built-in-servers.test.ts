import { describe, it, expect } from 'vitest';
import { getBuiltInMcpServers } from '../../src/mcp/built-in-servers.js';

function envWith(overrides?: Record<string, unknown>): Env {
  return { GOVERNANCE_AGENT_URL: 'https://gov.example.com/mcp/', ...overrides } as unknown as Env;
}

function envWithDaSc(overrides?: Record<string, unknown>): Env {
  return {
    GOVERNANCE_AGENT_URL: undefined,
    DA_SC_MCP_URL: 'https://da-sc-mcp.example.com/mcp',
    ...overrides,
  } as unknown as Env;
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

  it('returns both servers when both env vars are set', () => {
    const servers = getBuiltInMcpServers({
      GOVERNANCE_AGENT_URL: 'https://gov.example.com/mcp/',
      DA_SC_MCP_URL: 'https://da-sc-mcp.example.com/mcp',
    } as unknown as Env);
    expect(servers).toHaveProperty('governance-agent');
    expect(servers).toHaveProperty('da-sc');
  });

  it('returns da-sc when DA_SC_MCP_URL is set', () => {
    const servers = getBuiltInMcpServers(envWithDaSc());
    expect(servers).toHaveProperty('da-sc');
    expect(servers['da-sc'].url).toBe('https://da-sc-mcp.example.com/mcp');
  });

  it('omits da-sc when DA_SC_MCP_URL is unset', () => {
    const servers = getBuiltInMcpServers(envWithDaSc({ DA_SC_MCP_URL: undefined }));
    expect(servers).not.toHaveProperty('da-sc');
  });

  it('does not send the IMS token for da-sc (stateless, auth-free server)', () => {
    const servers = getBuiltInMcpServers(envWithDaSc());
    expect(servers['da-sc'].sendImsToken).toBeUndefined();
  });

  it('da-sc instructions reference the schema path and editor URL conventions', () => {
    const servers = getBuiltInMcpServers(envWithDaSc());
    expect(servers['da-sc'].instructions).toContain('/.da/forms/schemas/');
    expect(servers['da-sc'].instructions).toContain('da.live/apps/schema');
    expect(servers['da-sc'].instructions).toContain('da.live/form');
  });

  it('gates evaluate_* tools behind a post-execution continuation approval', () => {
    const servers = getBuiltInMcpServers(envWith());
    expect(servers['governance-agent'].continuationApprovalPatterns).toEqual(['evaluate_*']);
  });
});
