import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { createDATools } from '../src/tools/tools.js';
import type { CollabClient } from '../src/collab-client.js';
import type { DAAdminClient } from '../src/da-admin/client.js';

const TOOL_CALL_OPTIONS = { toolCallId: 'test-call-id', messages: [] as never[] };

const CONTENT_HTML = '<body><main><div><p>Hello world</p></div></main></body>';

function makeMockCollab(overrides: Partial<CollabClient> = {}): CollabClient {
  return {
    isConnected: true,
    status: 'connected',
    applyOperations: vi.fn().mockReturnValue([
      { type: 'replace_text', success: true, message: 'Replaced "old" with "new"' },
    ]),
    getContent: vi.fn().mockReturnValue(CONTENT_HTML),
    disconnect: vi.fn(),
    connect: vi.fn(),
    setAwarenessState: vi.fn(),
    setCursorAtStart: vi.fn(),
    setCursorAtElement: vi.fn(),
    applyContent: vi.fn(),
    ...overrides,
  } as unknown as CollabClient;
}

function makeMockClient(overrides: Partial<DAAdminClient> = {}): DAAdminClient {
  return {
    updateSource: vi.fn().mockResolvedValue({ updated: true }),
    ...overrides,
  } as unknown as DAAdminClient;
}

const BASE_CTX = {
  pageContext: {
    org: 'org', site: 'site', path: 'page.html', view: 'edit',
  },
};

describe('da_read_content tool', () => {
  it('calls applyOperations with read_content', async () => {
    const mockCollab = makeMockCollab({
      applyOperations: vi.fn().mockReturnValue([{
        type: 'read_content', success: true, message: 'Content read successfully', content: CONTENT_HTML,
      }]),
    });
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    const result = await tools.da_read_content.execute(
      { org: 'org', repo: 'site', path: 'page.html' },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{ type: 'read_content' }]);
    expect((result as { results: { content: string }[] }).results[0].content).toBe(CONTENT_HTML);
  });

  it('returns an error when no collab session', async () => {
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: null });

    const result = await tools.da_read_content.execute(
      { org: 'org', repo: 'site', path: 'page.html' },
      TOOL_CALL_OPTIONS,
    );

    expect(result).toHaveProperty('error');
  });
});

describe('da_replace_text tool', () => {
  let mockCollab: CollabClient;

  beforeEach(() => {
    mockCollab = makeMockCollab();
  });

  it('calls applyOperations with replace_text op', async () => {
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_replace_text.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', find: 'old', replace: 'new',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{
      type: 'replace_text', find: 'old', replace: 'new', nth: undefined,
    }]);
  });

  it('does not call updateSource', async () => {
    const mockClient = makeMockClient();
    const tools = createDATools(mockClient, { ...BASE_CTX, collab: mockCollab });

    await tools.da_replace_text.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', find: 'x', replace: 'y',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockClient.updateSource).not.toHaveBeenCalled();
  });

  it('does not disconnect (server handles lifecycle)', async () => {
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_replace_text.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', find: 'x', replace: 'y',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.disconnect).not.toHaveBeenCalled();
  });

  it('returns source and results on success', async () => {
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    const result = await tools.da_replace_text.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', find: 'x', replace: 'y',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(result).toMatchObject({ source: 'collab', path: 'page.html' });
  });

  it('returns an error when no collab session', async () => {
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: null });

    const result = await tools.da_replace_text.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', find: 'x', replace: 'y',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(result).toHaveProperty('error');
  });
});

describe('da_insert_element tool', () => {
  it('calls applyOperations with insert_element op', async () => {
    const mockCollab = makeMockCollab({
      applyOperations: vi.fn().mockReturnValue([{
        type: 'insert_element', success: true, message: 'Element inserted',
      }]),
    });
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_insert_element.execute(
      {
        org: 'org',
        repo: 'site',
        path: 'page.html',
        anchor: 'Hello world',
        insertPosition: 'after',
        html: '<p>New paragraph</p>',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{
      type: 'insert_element',
      anchor: 'Hello world',
      insertPosition: 'after',
      html: '<p>New paragraph</p>',
      anchorType: undefined,
      anchorIndex: undefined,
    }]);
  });
});

describe('da_delete_element tool', () => {
  it('calls applyOperations with delete_element op', async () => {
    const mockCollab = makeMockCollab({
      applyOperations: vi.fn().mockReturnValue([{
        type: 'delete_element', success: true, message: 'Element deleted',
      }]),
    });
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_delete_element.execute(
      {
        org: 'org', repo: 'site', path: 'page.html', anchor: 'Hello world',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{
      type: 'delete_element',
      anchor: 'Hello world',
      anchorType: undefined,
      anchorIndex: undefined,
    }]);
  });
});

describe('da_replace_element tool', () => {
  it('calls applyOperations with replace_element op', async () => {
    const mockCollab = makeMockCollab({
      applyOperations: vi.fn().mockReturnValue([{
        type: 'replace_element', success: true, message: 'Element replaced',
      }]),
    });
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_replace_element.execute(
      {
        org: 'org',
        repo: 'site',
        path: 'page.html',
        anchor: 'Hello world',
        html: '<p>Replaced</p>',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{
      type: 'replace_element',
      anchor: 'Hello world',
      html: '<p>Replaced</p>',
      anchorType: undefined,
      anchorIndex: undefined,
    }]);
  });
});

describe('da_update_attribute tool', () => {
  it('calls applyOperations with update_attribute op', async () => {
    const mockCollab = makeMockCollab({
      applyOperations: vi.fn().mockReturnValue([{
        type: 'update_attribute', success: true, message: 'Attribute updated',
      }]),
    });
    const tools = createDATools(makeMockClient(), { ...BASE_CTX, collab: mockCollab });

    await tools.da_update_attribute.execute(
      {
        org: 'org',
        repo: 'site',
        path: 'page.html',
        anchor: 'Get started',
        attribute: 'href',
        value: '/new/path',
      },
      TOOL_CALL_OPTIONS,
    );

    expect(mockCollab.applyOperations).toHaveBeenCalledWith([{
      type: 'update_attribute',
      anchor: 'Get started',
      attribute: 'href',
      value: '/new/path',
      anchorType: undefined,
      anchorIndex: undefined,
    }]);
  });
});
