import { describe, it, expect } from 'vitest';
import {
  PageContextSchema,
  ChatRequestSchema,
  McpToolsRequestSchema,
  normalizeMcpHeadersInput,
} from '../src/request-schemas.js';

describe('PageContextSchema', () => {
  it('accepts valid page context', () => {
    const result = PageContextSchema.safeParse({ org: 'adobe', site: 'docs', path: '/index.html' });
    expect(result.success).toBe(true);
  });

  it('accepts optional view field', () => {
    const result = PageContextSchema.safeParse({
      org: 'adobe',
      site: 'docs',
      path: '/index.html',
      view: 'edit',
    });
    expect(result.success).toBe(true);
    expect(result.data?.view).toBe('edit');
  });

  it('rejects missing org', () => {
    const result = PageContextSchema.safeParse({ site: 'docs', path: '/index.html' });
    expect(result.success).toBe(false);
  });

  it('rejects missing site', () => {
    const result = PageContextSchema.safeParse({ org: 'adobe', path: '/index.html' });
    expect(result.success).toBe(false);
  });

  it('rejects missing path', () => {
    const result = PageContextSchema.safeParse({ org: 'adobe', site: 'docs' });
    expect(result.success).toBe(false);
  });
});

describe('ChatRequestSchema', () => {
  it('accepts minimal valid request (messages only)', () => {
    const result = ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hello' }] });
    expect(result.success).toBe(true);
  });

  it('accepts full request with all optional fields', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
      pageContext: { org: 'adobe', site: 'docs', path: '/index.html' },
      imsToken: 'tok',
      agentId: 'agent-1',
      requestedSkills: ['skill-a'],
      mcpServers: { myServer: 'https://mcp.example.com' },
      mcpServerHeaders: { myServer: { Authorization: 'Bearer xyz' } },
      attachments: [
        { id: 'a1', fileName: 'img.png', mediaType: 'image/png', dataBase64: 'abc123' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing messages', () => {
    const result = ChatRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts attachment with contentUrl instead of dataBase64', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [],
      attachments: [
        {
          id: 'a1',
          fileName: 'img.png',
          mediaType: 'image/png',
          contentUrl: 'https://da.live/source/org/site/img.png',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects attachment with neither dataBase64 nor contentUrl', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [],
      attachments: [{ id: 'a1', fileName: 'f.txt', mediaType: 'text/plain' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects attachment with empty id', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [],
      attachments: [{ id: '', fileName: 'f.txt', mediaType: 'text/plain', dataBase64: 'data' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional sessionId', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      sessionId: 'session-abc-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('session-abc-123');
    }
  });

  it('accepts request without sessionId', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBeUndefined();
    }
  });

  it('rejects empty sessionId', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      sessionId: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('McpToolsRequestSchema', () => {
  it('accepts valid servers map', () => {
    const result = McpToolsRequestSchema.safeParse({
      servers: { myMcp: 'https://mcp.example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts servers with header list', () => {
    const result = McpToolsRequestSchema.safeParse({
      servers: { myMcp: 'https://mcp.example.com' },
      serverHeaders: { myMcp: [{ name: 'Authorization', value: 'Bearer tok' }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts servers with header map', () => {
    const result = McpToolsRequestSchema.safeParse({
      servers: { myMcp: 'https://mcp.example.com' },
      serverHeaders: { myMcp: { Authorization: 'Bearer tok' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing servers', () => {
    const result = McpToolsRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('normalizeMcpHeadersInput', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeMcpHeadersInput(undefined)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(normalizeMcpHeadersInput([])).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(normalizeMcpHeadersInput({})).toBeUndefined();
  });

  it('converts name/value array to record', () => {
    const input = [
      { name: 'Authorization', value: 'Bearer tok' },
      { name: 'X-Custom', value: 'val' },
    ];
    expect(normalizeMcpHeadersInput(input)).toEqual({
      Authorization: 'Bearer tok',
      'X-Custom': 'val',
    });
  });

  it('passes through non-empty record as-is', () => {
    const input = { Authorization: 'Bearer tok' };
    expect(normalizeMcpHeadersInput(input)).toBe(input);
  });
});
