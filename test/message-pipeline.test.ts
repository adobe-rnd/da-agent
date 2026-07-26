import { describe, it, expect } from 'vitest';
import {
  resolveApprovals,
  stripClientOnlyToolInputs,
  stripClientOnlyFromArgs,
  ensureOrphanedToolResults,
  expandUserSelectionContextForModel,
  expandLatestUserAttachmentsForModel,
} from '../src/message-pipeline.js';

describe('stripClientOnlyFromArgs', () => {
  it('removes _da-prefixed keys', () => {
    expect(stripClientOnlyFromArgs({ path: '/a', _daRevertSnapshot: 'snap' })).toEqual({
      path: '/a',
    });
  });

  it('returns original if no _da keys', () => {
    const args = { path: '/a', format: 'html' };
    expect(stripClientOnlyFromArgs(args)).toEqual(args);
  });

  it('returns null/undefined as-is', () => {
    expect(stripClientOnlyFromArgs(null)).toBeNull();
    expect(stripClientOnlyFromArgs(undefined)).toBeUndefined();
  });
});

describe('stripClientOnlyToolInputs', () => {
  it('strips _da keys from tool-call inputs in assistant messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'update',
            input: { path: '/a', _daSnap: 'x' },
          },
        ],
      },
    ];
    const result = stripClientOnlyToolInputs(messages);
    expect(result[0].content[0].input).toEqual({ path: '/a' });
  });

  it('leaves non-assistant messages untouched', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const result = stripClientOnlyToolInputs(messages);
    expect(result).toEqual(messages);
  });

  it('leaves tool-calls without _da keys untouched', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: { path: '/a' } },
        ],
      },
    ];
    const result = stripClientOnlyToolInputs(messages);
    expect(result[0]).toBe(messages[0]);
  });
});

describe('expandUserSelectionContextForModel', () => {
  it('prepends selection context to user message content', () => {
    const messages = [
      {
        role: 'user',
        content: 'Fix this',
        selectionContext: [{ proseIndex: 0, blockName: 'Hero', innerText: 'Hello world' }],
      },
    ];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0].content).toContain('Hero');
    expect(result[0].content).toContain('Fix this');
    expect(result[0]).not.toHaveProperty('selectionContext');
  });

  it('strips selectionContext even when empty', () => {
    const messages = [{ role: 'user', content: 'hello', selectionContext: [] }];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0]).not.toHaveProperty('selectionContext');
    expect(result[0].content).toBe('hello');
  });

  it('leaves non-user messages untouched', () => {
    const messages = [{ role: 'assistant', content: 'ok' }];
    const result = expandUserSelectionContextForModel(messages);
    expect(result).toEqual(messages);
  });

  it('handles missing blockName gracefully', () => {
    const messages = [
      {
        role: 'user',
        content: 'Fix',
        selectionContext: [{ proseIndex: 2, innerText: 'text' }],
      },
    ];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0].content).toContain('Prose section');
  });

  it('formats text-type selections with innerHTML', () => {
    const messages = [
      {
        role: 'user',
        content: 'Rewrite',
        selectionContext: [
          {
            type: 'text',
            proseIndex: 5,
            innerHTML: '<p>world</p><p>Foo</p>',
          },
        ],
      },
    ];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0].content).toContain('Text selection');
    expect(result[0].content).toContain('<p>world</p><p>Foo</p>');
    expect(result[0].content).not.toContain('Prose section');
  });

  it('labels file items correctly without editor index', () => {
    const messages = [
      {
        role: 'user',
        content: 'What is this?',
        selectionContext: [
          {
            type: 'file',
            blockName: 'my-page',
            innerText: 'Selected repository path: org/site/my-page',
          },
        ],
      },
    ];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0].content).toContain('File "my-page"');
    expect(result[0].content).not.toContain('editor index');
  });

  it('labels folder items correctly without editor index', () => {
    const messages = [
      {
        role: 'user',
        content: 'List contents',
        selectionContext: [
          {
            type: 'folder',
            blockName: 'articles',
            innerText: 'Selected repository path: org/site/articles',
          },
        ],
      },
    ];
    const result = expandUserSelectionContextForModel(messages);
    expect(result[0].content).toContain('Folder "articles"');
    expect(result[0].content).not.toContain('editor index');
  });
});

describe('expandLatestUserAttachmentsForModel', () => {
  it('prepends attachment info to the last user message', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'see image' },
    ];
    const meta = [{ id: 'a1', fileName: 'photo.jpg', mediaType: 'image/jpeg' }];
    const result = expandLatestUserAttachmentsForModel(messages, meta);
    expect(result[2].content).toContain('photo.jpg');
    expect(result[2].content).toContain('see image');
    expect(result[0].content).toBe('first');
  });

  it('strips attachmentsMeta from all user messages', () => {
    const messages = [{ role: 'user', content: 'hi', attachmentsMeta: [{ id: 'a1' }] }];
    const result = expandLatestUserAttachmentsForModel(messages, []);
    expect(result[0]).not.toHaveProperty('attachmentsMeta');
  });

  it('includes sizeBytes when present', () => {
    const messages = [{ role: 'user', content: 'see file' }];
    const meta = [{ id: 'a1', fileName: 'doc.pdf', mediaType: 'application/pdf', sizeBytes: 1024 }];
    const result = expandLatestUserAttachmentsForModel(messages, meta);
    expect(result[0].content).toContain('1024 bytes');
  });

  it('returns messages unchanged when meta is empty', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const result = expandLatestUserAttachmentsForModel(messages, []);
    expect(result[0].content).toBe('hi');
  });

  it('separates pending and uploaded attachments in the prompt', () => {
    const messages = [{ role: 'user', content: 'see files' }];
    const meta = [
      { id: 'a1', fileName: 'new.png', mediaType: 'image/png' },
      {
        id: 'a2',
        fileName: 'old.png',
        mediaType: 'image/png',
        contentUrl: 'https://da.live/source/org/site/old.png',
      },
    ];
    const result = expandLatestUserAttachmentsForModel(messages, meta);
    expect(result[0].content).toContain('new.png');
    expect(result[0].content).toContain('content_upload');
    expect(result[0].content).toContain('Previously uploaded');
    expect(result[0].content).toContain('https://da.live/source/org/site/old.png');
  });

  it('omits pending section when all attachments have contentUrl', () => {
    const messages = [{ role: 'user', content: 'use them' }];
    const meta = [
      {
        id: 'a1',
        fileName: 'already.png',
        mediaType: 'image/png',
        contentUrl: 'https://da.live/source/org/site/already.png',
      },
    ];
    const result = expandLatestUserAttachmentsForModel(messages, meta);
    expect(result[0].content).not.toContain('call content_upload using attachmentRef');
    expect(result[0].content).toContain('Previously uploaded');
  });
});

describe('ensureOrphanedToolResults', () => {
  it('returns messages unchanged when all tool-calls have results', () => {
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            toolName: 'read',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ];
    expect(ensureOrphanedToolResults(messages)).toEqual(messages);
  });

  it('injects synthetic error result for orphaned tool-call', () => {
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: {} }],
      },
      { role: 'assistant', content: 'summary' },
    ];
    const result = ensureOrphanedToolResults(messages);
    expect(result).toHaveLength(4);
    expect(result[2].role).toBe('tool');
    expect(result[2].content[0].type).toBe('tool-result');
    expect(result[2].content[0].toolCallId).toBe('tc1');
    expect(result[2].content[0].output.type).toBe('error-text');
    expect(result[3]).toEqual({ role: 'assistant', content: 'summary' });
  });

  it('handles multiple orphans from the same assistant message', () => {
    const messages = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'create', input: {} },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'create', input: {} },
        ],
      },
    ];
    const result = ensureOrphanedToolResults(messages);
    expect(result).toHaveLength(3);
    const injected = result[2];
    expect(injected.role).toBe('tool');
    expect(injected.content).toHaveLength(2);
    expect(injected.content[0].toolCallId).toBe('tc1');
    expect(injected.content[1].toolCallId).toBe('tc2');
  });

  it('injects only for unresolved tool-calls, preserving existing results', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: {} },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'create', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            toolName: 'read',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ];
    const result = ensureOrphanedToolResults(messages);
    expect(result).toHaveLength(3);
    const injected = result[1];
    expect(injected.role).toBe('tool');
    expect(injected.content).toHaveLength(1);
    expect(injected.content[0].toolCallId).toBe('tc2');
    expect(result[2].content[0].toolCallId).toBe('tc1');
  });

  it('leaves text-only messages untouched', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(ensureOrphanedToolResults(messages)).toEqual(messages);
  });
});

describe('resolveApprovals', () => {
  it('returns messages unchanged when no approvals exist', async () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const result = await resolveApprovals(messages, {});
    expect(result).toEqual(messages);
  });

  it('executes fresh approved tool and creates tool-result', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'myTool', input: { x: 1 } },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: true }],
      },
    ];
    const tools = {
      myTool: { execute: async (args: Record<string, unknown>) => `executed with ${args.x}` },
    };
    const result = await resolveApprovals(messages, tools);
    const toolMsg = result[1];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content[0].type).toBe('tool-result');
    expect(toolMsg.content[0].output.value).toBe('executed with 1');
  });

  it('creates rejection result for rejected approval', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'myTool', input: {} },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: false }],
      },
    ];
    const result = await resolveApprovals(messages, {});
    expect(result[1].content[0].output.value.message).toBe('Action rejected by user.');
  });

  it('creates synthetic result for stale approval', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'myTool', input: {} },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: true }],
      },
      { role: 'assistant', content: 'I did the thing' },
      { role: 'user', content: 'thanks' },
    ];
    const result = await resolveApprovals(messages, {});
    expect(result[1].content[0].output.value).toBe('(previously executed)');
  });

  it('strips _da keys from args before executing', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc1',
            toolName: 'myTool',
            input: { path: '/a', _daSnap: 'x' },
          },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: true }],
      },
    ];
    const tools = {
      myTool: {
        execute: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        },
      },
    };
    await resolveApprovals(messages, tools);
    expect(capturedArgs).toEqual({ path: '/a' });
  });
});

describe('resolveApprovals + ensureOrphanedToolResults pipeline', () => {
  it('resolved approval tool-call does not get a second synthetic result', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'create', input: {} },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: true }],
      },
    ];
    const tools = { create: { execute: async () => 'done' } };
    const afterApprovals = await resolveApprovals(messages, tools);
    const afterOrphans = ensureOrphanedToolResults(afterApprovals);
    expect(afterOrphans).toEqual(afterApprovals);
  });

  it('rejected stale approval does not trigger orphan injection', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'create', input: {} },
          { type: 'tool-approval-request', toolCallId: 'tc1', approvalId: 'ap1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: false }],
      },
      { role: 'assistant', content: 'ok, skipped' },
      { role: 'user', content: 'thanks' },
    ];
    const afterApprovals = await resolveApprovals(messages, {});
    const afterOrphans = ensureOrphanedToolResults(afterApprovals);
    expect(afterOrphans).toEqual(afterApprovals);
  });
});
