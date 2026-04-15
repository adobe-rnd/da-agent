import { describe, it, expect } from 'vitest';
import { extractTextFromA2AResult, parseA2aSseResponse } from '../src/aem-shift-left/a2a-sse.js';

describe('extractTextFromA2AResult', () => {
  it('reads text part from message', () => {
    const r = extractTextFromA2AResult({
      kind: 'message',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    expect(r).toBe('Hello');
  });

  it('skips Processing placeholder', () => {
    const r = extractTextFromA2AResult({
      kind: 'message',
      parts: [{ kind: 'text', text: 'Processing...' }],
    });
    expect(r).toBeNull();
  });
});

describe('parseA2aSseResponse', () => {
  it('parses SSE lines into final message and context_id', async () => {
    const sse = [
      'data: {"jsonrpc":"2.0","id":"1","result":{"kind":"status-update","final":false,"contextId":"ctx-1","status":{"message":{"parts":[{"kind":"text","text":"Thinking"}]}}}}',
      '',
      'data: {"jsonrpc":"2.0","id":"1","result":{"kind":"message","final":true,"contextId":"ctx-1","parts":[{"kind":"text","text":"Done"}]}}',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const out = await parseA2aSseResponse(stream);
    expect(out.message).toBe('Done');
    expect(out.context_id).toBe('ctx-1');
    expect(out.status).toBe('completed');
    expect(out.final_updates).toContain('Done');
  });
});
