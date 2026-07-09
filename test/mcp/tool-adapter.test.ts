import { describe, it, expect } from 'vitest';
import { mcpToolToAITool } from '../../src/mcp/tool-adapter.js';
import type { MCPClient, MCPToolDefinition } from '../../src/mcp/client.js';

const fakeClient = {} as MCPClient;

describe('mcpToolToAITool', () => {
  it('gates the tool behind approval when the server sets destructiveHint', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'approve_request',
      annotations: { destructiveHint: true },
    };

    const { tool: aiTool } = mcpToolToAITool('publish-workflow', mcpTool, fakeClient);

    expect(await aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] })).toBe(true);
  });

  it('does not gate the tool when the server sets no annotations', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'list_pending_requests',
    };

    const { tool: aiTool } = mcpToolToAITool('publish-workflow', mcpTool, fakeClient);

    expect(await aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] })).toBe(false);
  });
});
