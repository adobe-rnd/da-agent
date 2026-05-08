import { describe, it, expect } from 'vitest';
import { getBuiltInMcpServers } from '../../src/mcp/built-in-servers.js';

function envWith(environment?: string): Env {
  return { ENVIRONMENT: environment } as unknown as Env;
}

describe('getBuiltInMcpServers', () => {
  it('returns production servers by default', () => {
    const servers = getBuiltInMcpServers(envWith(undefined));
    expect(servers).toHaveProperty('governance-agent');
    expect(servers['governance-agent'].url).toContain('cloud.adobe.io');
  });

  it('returns production servers for explicit production', () => {
    const servers = getBuiltInMcpServers(envWith('production'));
    expect(servers).toHaveProperty('governance-agent');
    expect(servers['governance-agent'].url).toContain('cloud.adobe.io');
  });

  it('returns ci servers for ci environment', () => {
    const servers = getBuiltInMcpServers(envWith('ci'));
    expect(servers).toHaveProperty('governance-agent');
    expect(servers['governance-agent'].url).toContain('stage');
  });

  it('returns dev servers for dev environment', () => {
    const servers = getBuiltInMcpServers(envWith('dev'));
    expect(servers).toHaveProperty('governance-agent');
    expect(servers['governance-agent'].url).toContain('stage');
  });

  it('returns empty object for unknown environment', () => {
    const servers = getBuiltInMcpServers(envWith('unknown'));
    expect(Object.keys(servers)).toHaveLength(0);
  });

  it('all environments set sendImsToken to true', () => {
    for (const env of ['production', 'ci', 'dev']) {
      const servers = getBuiltInMcpServers(envWith(env));
      expect(servers['governance-agent'].sendImsToken).toBe(true);
    }
  });

  it('all environments include instructions', () => {
    for (const env of ['production', 'ci', 'dev']) {
      const servers = getBuiltInMcpServers(envWith(env));
      expect(servers['governance-agent'].instructions).toContain('Live Preview URL');
    }
  });
});
