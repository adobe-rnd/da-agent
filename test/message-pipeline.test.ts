import { describe, it, expect } from 'vitest';
import {
  reconcileApprovals,
  toModelMessages,
  stripClientOnlyToolInputs,
  stripClientOnlyFromArgs,
  ensureOrphanedToolResults,
  expandUserSelectionContextForModel,
  expandLatestUserAttachmentsForModel,
  TOOL_STATE,
} from '../src/message-pipeline.js';

// Build a v2 assistant message wrapping a single tool part.
const toolMsg = (part: Record<string, unknown>) => ({
  role: 'assistant',
  content: [{ type: 'tool', ...part }],
});

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

describe('reconcileApprovals', () => {
  it('returns messages unchanged with no executed outputs when nothing is approved', async () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const { messages: out, executedOutputs } = await reconcileApprovals(messages, {});
    expect(out).toEqual(messages);
    expect(executedOutputs).toEqual([]);
  });

  it('executes an approved tool part and attaches its output', async () => {
    const messages = [
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: { x: 1 },
        state: TOOL_STATE.APPROVED,
      }),
    ];
    const tools = {
      myTool: { execute: async (args: Record<string, unknown>) => `executed with ${args.x}` },
    };
    const { messages: out, executedOutputs } = await reconcileApprovals(messages, tools);
    expect(out[0].content[0].state).toBe(TOOL_STATE.OUTPUT_AVAILABLE);
    expect(out[0].content[0].output).toBe('executed with 1');
    expect(executedOutputs).toEqual([
      { toolCallId: 'tc1', output: 'executed with 1', isError: false },
    ]);
  });

  // Bug 1 + Bug 3: every approved tool in the batch runs, and they run in order.
  it('executes multiple approved tool parts sequentially in order', async () => {
    const order: string[] = [];
    const messages = [
      toolMsg({ toolCallId: 'a', toolName: 'run', input: { id: 'a' }, state: TOOL_STATE.APPROVED }),
      toolMsg({ toolCallId: 'b', toolName: 'run', input: { id: 'b' }, state: TOOL_STATE.APPROVED }),
    ];
    const tools = {
      run: {
        execute: async (args: Record<string, unknown>) => {
          order.push(args.id as string);
          return `ran ${args.id}`;
        },
      },
    };
    const { messages: out, executedOutputs } = await reconcileApprovals(messages, tools);
    expect(order).toEqual(['a', 'b']);
    expect(out[0].content[0].state).toBe(TOOL_STATE.OUTPUT_AVAILABLE);
    expect(out[1].content[0].state).toBe(TOOL_STATE.OUTPUT_AVAILABLE);
    expect(executedOutputs.map((o) => o.toolCallId)).toEqual(['a', 'b']);
  });

  it('leaves rejected parts untouched and does not execute them', async () => {
    let called = false;
    const messages = [
      toolMsg({ toolCallId: 'tc1', toolName: 'myTool', input: {}, state: TOOL_STATE.REJECTED }),
    ];
    const tools = {
      myTool: {
        execute: async () => {
          called = true;
          return 'x';
        },
      },
    };
    const { messages: out, executedOutputs } = await reconcileApprovals(messages, tools);
    expect(called).toBe(false);
    expect(out[0].content[0].state).toBe(TOOL_STATE.REJECTED);
    expect(executedOutputs).toEqual([]);
  });

  it('captures execution errors as output-error', async () => {
    const messages = [
      toolMsg({ toolCallId: 'tc1', toolName: 'boom', input: {}, state: TOOL_STATE.APPROVED }),
    ];
    const tools = {
      boom: {
        execute: async () => {
          throw new Error('kaboom');
        },
      },
    };
    const { messages: out, executedOutputs } = await reconcileApprovals(messages, tools);
    expect(out[0].content[0].state).toBe(TOOL_STATE.OUTPUT_ERROR);
    expect(out[0].content[0].errorText).toBe('kaboom');
    expect(executedOutputs).toEqual([{ toolCallId: 'tc1', isError: true, errorText: 'kaboom' }]);
  });

  it('strips _da keys from input before executing', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const messages = [
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: { path: '/a', _daSnap: 'x' },
        state: TOOL_STATE.APPROVED,
      }),
    ];
    const tools = {
      myTool: {
        execute: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        },
      },
    };
    await reconcileApprovals(messages, tools);
    expect(capturedArgs).toEqual({ path: '/a' });
  });
});

describe('toModelMessages', () => {
  it('passes user messages through and stringifies assistant text', () => {
    const out = toModelMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('expands an output-available tool part into tool-call + tool-result', () => {
    const out = toModelMessages([
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: { x: 1 },
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        output: { ok: true },
      }),
    ]);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'myTool', input: { x: 1 } }],
    });
    expect(out[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'myTool',
          output: { type: 'json', value: { ok: true } },
        },
      ],
    });
  });

  it('emits an error-text result for output-error parts', () => {
    const out = toModelMessages([
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: {},
        state: TOOL_STATE.OUTPUT_ERROR,
        errorText: 'nope',
      }),
    ]);
    expect(out[1].content[0].output).toEqual({ type: 'error-text', value: 'nope' });
  });

  it('emits a rejection result for rejected parts (so the tool_use is not orphaned)', () => {
    const out = toModelMessages([
      toolMsg({ toolCallId: 'tc1', toolName: 'myTool', input: {}, state: TOOL_STATE.REJECTED }),
    ]);
    expect(out[1].content[0].output).toEqual({
      type: 'json',
      value: { message: 'Action rejected by user.' },
    });
  });

  it('strips _da keys from tool-call input', () => {
    const out = toModelMessages([
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: { path: '/a', _daSnap: 'x' },
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        output: 'ok',
      }),
    ]);
    expect(out[0].content[0].input).toEqual({ path: '/a' });
  });

  it('leaves a tool part with no result unresolved for the orphan safety net', () => {
    const out = toModelMessages([
      toolMsg({
        toolCallId: 'tc1',
        toolName: 'myTool',
        input: {},
        state: TOOL_STATE.INPUT_AVAILABLE,
      }),
    ]);
    // assistant tool-call only; no tool message
    expect(out).toHaveLength(1);
    expect(out[0].content[0].type).toBe('tool-call');
    // the orphan net then injects a synthetic result
    const withOrphans = ensureOrphanedToolResults(out);
    expect(withOrphans[1].content[0].type).toBe('tool-result');
  });
});
