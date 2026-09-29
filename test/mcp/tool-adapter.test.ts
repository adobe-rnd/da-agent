import { describe, it, expect } from 'vitest';
import { mcpToolToAITool, matchesGlob } from '../../src/mcp/tool-adapter.js';
import type { MCPClient, MCPToolDefinition } from '../../src/mcp/client.js';

const fakeClient = {} as MCPClient;

function needsApproval(mcpTool: MCPToolDefinition): Promise<boolean | undefined> {
  const { tool: aiTool } = mcpToolToAITool('publish-workflow', mcpTool, fakeClient);
  return Promise.resolve(aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function continuationFlag(aiTool: any): boolean {
  return aiTool.providerOptions?.daAgent?.continuationApproval === true;
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

describe('matchesGlob', () => {
  it('matches a trailing wildcard', () => {
    expect(matchesGlob('evaluate_page', 'evaluate_*')).toBe(true);
    expect(matchesGlob('evaluate_image', 'evaluate_*')).toBe(true);
  });

  it('does not match a different prefix', () => {
    expect(matchesGlob('retrieve_page', 'evaluate_*')).toBe(false);
  });

  it('requires a full-string match (anchored)', () => {
    expect(matchesGlob('pre_evaluate_page', 'evaluate_*')).toBe(false);
    expect(matchesGlob('evaluate', 'evaluate_*')).toBe(false);
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
    expect(matchesGlob('axb', 'a.b')).toBe(false);
  });
});

describe('mcpToolToAITool continuation approval', () => {
  it('flags a matching tool for continuation approval independently of pre-exec approval', async () => {
    const { tool: aiTool } = mcpToolToAITool(
      'governance-agent',
      { name: 'evaluate_page' },
      fakeClient,
      ['evaluate_*'],
    );
    expect(continuationFlag(aiTool)).toBe(true);
    // Continuation gating and pre-execution approval are independent: this
    // unannotated tool still fails closed on the pre-exec gate while also being
    // continuation-gated, so it can be both pre-gated and post-gated.
    expect(await aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] })).toBe(true);
  });

  it('does not flag a non-matching tool and keeps annotation-based gating', async () => {
    const { tool: aiTool } = mcpToolToAITool(
      'governance-agent',
      { name: 'retrieve_brand_rules' },
      fakeClient,
      ['evaluate_*'],
    );
    expect(continuationFlag(aiTool)).toBe(false);
    expect(await aiTool.needsApproval?.({}, { toolCallId: 'x', messages: [] })).toBe(true);
  });

  it('does not flag anything when no patterns are configured', () => {
    const { tool: aiTool } = mcpToolToAITool(
      'governance-agent',
      { name: 'evaluate_page' },
      fakeClient,
    );
    expect(continuationFlag(aiTool)).toBe(false);
  });
});
