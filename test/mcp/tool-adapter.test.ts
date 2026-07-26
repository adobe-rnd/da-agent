import { describe, it, expect } from 'vitest';
import { mcpToolToAITool } from '../../src/mcp/tool-adapter.js';
import type { MCPClient, MCPToolDefinition } from '../../src/mcp/client.js';

const fakeClient = {} as MCPClient;

function needsApproval(mcpTool: MCPToolDefinition): Promise<boolean | undefined> {
  const { tool: aiTool } = mcpToolToAITool('publish-workflow', mcpTool, fakeClient);
  return Promise.resolve(aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] }));
}

describe('mcpToolToAITool', () => {
  it('gates the tool behind approval when the server sets destructiveHint', async () => {
    expect(
      await needsApproval({ name: 'approve_request', annotations: { destructiveHint: true } }),
    ).toBe(true);
  });

  it('gates the tool when the server sets no annotations (fail-closed)', async () => {
    expect(await needsApproval({ name: 'list_pending_requests' })).toBe(true);
  });

  it('does not gate the tool when the server marks it read-only', async () => {
    expect(
      await needsApproval({ name: 'list_pending_requests', annotations: { readOnlyHint: true } }),
    ).toBe(false);
  });

  it('does not gate the tool when the server explicitly marks it non-destructive', async () => {
    expect(
      await needsApproval({ name: 'refresh_cache', annotations: { destructiveHint: false } }),
    ).toBe(false);
  });
});
