import { describe, expect, it } from 'vitest';
import {
  buildApprovalContinuationResponse,
  buildContinuationParts,
  getNewlyResolvedToolOutputs,
  hasPendingApprovals,
  resolvedToolCallIds,
  unwrapToolOutput,
} from '../src/tool-approval.js';

/** Collect the parsed `data:` payloads from a UI-message-stream SSE Response. */
async function readSseEvents(response: Response): Promise<any[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
    .filter((raw) => raw && raw !== '[DONE]')
    .map((raw) => JSON.parse(raw));
}

describe('tool approval helpers', () => {
  const assistantWithTwoApprovals = {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: 'call-a', toolName: 'da_create', input: {} },
      { type: 'tool-call', toolCallId: 'call-b', toolName: 'da_update', input: {} },
      { type: 'tool-approval-request', approvalId: 'appr-a', toolCallId: 'call-a' },
      { type: 'tool-approval-request', approvalId: 'appr-b', toolCallId: 'call-b' },
    ],
  };

  it('hasPendingApprovals is true when only one of two tools has a result', () => {
    const messages = [
      assistantWithTwoApprovals,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-a',
            toolName: 'da_create',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ];
    expect(hasPendingApprovals(messages)).toBe(true);
    expect(resolvedToolCallIds(messages)).toEqual(new Set(['call-a']));
  });

  it('hasPendingApprovals is false when every approval has a tool-result', () => {
    const messages = [
      assistantWithTwoApprovals,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-a',
            toolName: 'da_create',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-b',
            toolName: 'da_update',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ];
    expect(hasPendingApprovals(messages)).toBe(false);
  });

  it('getNewlyResolvedToolOutputs returns only results not in the original history', () => {
    const original = [
      assistantWithTwoApprovals,
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'appr-b', approved: true }],
      },
    ];
    const processed = [
      assistantWithTwoApprovals,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-a',
            toolName: 'da_create',
            output: { type: 'text', value: 'first' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-b',
            toolName: 'da_update',
            output: { type: 'text', value: 'second' },
          },
        ],
      },
    ];
    expect(getNewlyResolvedToolOutputs(original, processed)).toEqual([
      { toolCallId: 'call-a', output: { type: 'text', value: 'first' } },
      { toolCallId: 'call-b', output: { type: 'text', value: 'second' } },
    ]);

    const originalWithA = [
      ...original,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-a',
            toolName: 'da_create',
            output: { type: 'text', value: 'first' },
          },
        ],
      },
    ];
    expect(getNewlyResolvedToolOutputs(originalWithA, processed)).toEqual([
      { toolCallId: 'call-b', output: { type: 'text', value: 'second' } },
    ]);
  });

  describe('unwrapToolOutput', () => {
    it('unwraps a text envelope to its raw string value', () => {
      expect(unwrapToolOutput({ type: 'text', value: '{"a":1}' })).toBe('{"a":1}');
    });

    it('unwraps a json envelope to its raw object value', () => {
      expect(unwrapToolOutput({ type: 'json', value: { a: 1 } })).toEqual({ a: 1 });
    });

    it('unwraps an error-text envelope to its raw value', () => {
      expect(unwrapToolOutput({ type: 'error-text', value: 'boom' })).toBe('boom');
    });

    it('passes through values that are not {type,value} envelopes', () => {
      expect(unwrapToolOutput('plain string')).toBe('plain string');
      expect(unwrapToolOutput({ text_evaluation: {} })).toEqual({ text_evaluation: {} });
      expect(unwrapToolOutput(undefined)).toBe(undefined);
      expect(unwrapToolOutput(null)).toBe(null);
    });

    it('passes through genuine tool output that coincidentally has type/value keys', () => {
      const geoPoint = { type: 'Point', value: [1, 2] };
      expect(unwrapToolOutput(geoPoint)).toEqual(geoPoint);
    });
  });

  describe('buildApprovalContinuationResponse', () => {
    it('emits tool-output-available with the unwrapped raw output', async () => {
      const evaluation = { brand_name: 'Frescopa', text_evaluation: { successful_checks: 2 } };
      const response = buildApprovalContinuationResponse(
        [
          {
            toolCallId: 'call-a',
            output: { type: 'text', value: JSON.stringify(evaluation) },
          },
        ],
        { 'access-control-allow-origin': '*' },
      );

      const events = await readSseEvents(response);
      const outputEvent = events.find((e) => e.type === 'tool-output-available');

      expect(outputEvent).toBeDefined();
      expect(outputEvent.toolCallId).toBe('call-a');
      // Raw MCP shape (JSON string), not the { type, value } envelope.
      expect(outputEvent.output).toBe(JSON.stringify(evaluation));
      expect(events.some((e) => e.type === 'finish')).toBe(true);
    });
  });

  describe('buildContinuationParts', () => {
    const gates = (name: string) => name === 'mcp__governance-agent__evaluate_page';

    it('emits one transient part for a gated tool that produced a result', () => {
      const parts = buildContinuationParts(
        {
          toolCalls: [{ toolCallId: 'call-a', toolName: 'mcp__governance-agent__evaluate_page' }],
          toolResults: [{ toolCallId: 'call-a' }],
        },
        gates,
      );
      expect(parts).toEqual([
        {
          type: 'data-continuation',
          transient: true,
          data: { toolCallId: 'call-a', toolName: 'mcp__governance-agent__evaluate_page' },
        },
      ]);
    });

    it('does not emit for a non-gated tool', () => {
      const parts = buildContinuationParts(
        {
          toolCalls: [{ toolCallId: 'call-a', toolName: 'content_read' }],
          toolResults: [{ toolCallId: 'call-a' }],
        },
        gates,
      );
      expect(parts).toEqual([]);
    });

    it('does not emit for a gated tool that produced no result', () => {
      const parts = buildContinuationParts(
        {
          toolCalls: [{ toolCallId: 'call-a', toolName: 'mcp__governance-agent__evaluate_page' }],
          toolResults: [],
        },
        gates,
      );
      expect(parts).toEqual([]);
    });

    it('emits one part per gated tool in a multi-tool step', () => {
      const parts = buildContinuationParts(
        {
          toolCalls: [
            { toolCallId: 'call-a', toolName: 'mcp__governance-agent__evaluate_page' },
            { toolCallId: 'call-b', toolName: 'content_read' },
            { toolCallId: 'call-c', toolName: 'mcp__governance-agent__evaluate_page' },
          ],
          toolResults: [{ toolCallId: 'call-a' }, { toolCallId: 'call-c' }],
        },
        gates,
      );
      expect(parts.map((p) => p.data.toolCallId)).toEqual(['call-a', 'call-c']);
    });

    it('returns nothing when there is no final step', () => {
      expect(buildContinuationParts(undefined, gates)).toEqual([]);
    });
  });
});
