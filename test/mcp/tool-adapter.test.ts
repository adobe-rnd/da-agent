import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectAndRegisterMCPTools } from '../../src/mcp/tool-adapter.js';

const { MockMCPClient, mockInitialize, mockListTools } = vi.hoisted(() => {
  const initialize = vi.fn().mockResolvedValue(undefined);
  const listTools = vi.fn().mockResolvedValue([]);
  const Client = vi.fn().mockImplementation(() => ({ initialize, listTools }));
  return { MockMCPClient: Client, mockInitialize: initialize, mockListTools: listTools };
});

vi.mock('../../src/mcp/client.js', () => ({
  MCPClient: MockMCPClient,
}));

const minimalConfig = {
  mcpServers: { 'test-server': { type: 'http' as const, url: 'https://mcp.example.com/mcp' } },
  toolAllowPatterns: ['*'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInitialize.mockResolvedValue(undefined);
  mockListTools.mockResolvedValue([]);
});

describe('connectAndRegisterMCPTools', () => {
  it('passes callToolTimeout through to MCPClient constructor', async () => {
    await connectAndRegisterMCPTools(minimalConfig, { callToolTimeout: 5000 });
    expect(MockMCPClient).toHaveBeenCalledWith(
      'https://mcp.example.com/mcp',
      expect.objectContaining({ callToolTimeout: 5000 }),
    );
  });

  it('passes callToolTimeout as undefined when not provided, letting MCPClient use its default', async () => {
    await connectAndRegisterMCPTools(minimalConfig);
    expect(MockMCPClient).toHaveBeenCalledWith(
      'https://mcp.example.com/mcp',
      expect.objectContaining({ callToolTimeout: undefined }),
    );
  });
});
