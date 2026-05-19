import { describe, expect, it } from 'vitest';
import {
  getNewlyResolvedToolOutputs,
  hasPendingApprovals,
  resolvedToolCallIds,
} from '../src/tool-approval.js';

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
});
