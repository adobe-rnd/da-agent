import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildChatContext } from '../src/chat-context.js';

vi.mock('../src/collab-client.js', () => ({
  createCollabClient: vi.fn(async () => ({ disconnect: vi.fn() })),
  CollabClient: vi.fn(),
}));

vi.mock('../src/da-admin/client.js', () => ({
  DAAdminClient: vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    apiToken: opts.apiToken,
    getSiteConfig: vi.fn(async () => ({})),
  })),
}));

vi.mock('../src/eds-admin/client.js', () => ({
  EDSAdminClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/memory/loader.js', () => ({
  fetchProjectMemory: vi.fn(async () => 'remembered stuff'),
}));

function minimalBody(overrides?: Record<string, unknown>) {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  } as Parameters<typeof buildChatContext>[0];
}

function minimalEnv(overrides?: Record<string, unknown>): Env {
  return {
    AWS_BEARER_TOKEN_BEDROCK: 'token',
    LANGFUSE_PUBLIC_KEY: 'pub',
    LANGFUSE_SECRET_KEY: 'sec',
    DAADMIN: {} as Fetcher,
    DACOLLAB: {} as Fetcher,
    ...overrides,
  } as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildChatContext', () => {
  it('creates adminClient when imsToken and DAADMIN present', async () => {
    const ctx = await buildChatContext(minimalBody({ imsToken: 'tok' }), minimalEnv());
    expect(ctx.adminClient).not.toBeNull();
  });

  it('adminClient is null without imsToken', async () => {
    const ctx = await buildChatContext(minimalBody(), minimalEnv());
    expect(ctx.adminClient).toBeNull();
  });

  it('adminClient is null without DAADMIN', async () => {
    const ctx = await buildChatContext(
      minimalBody({ imsToken: 'tok' }),
      minimalEnv({ DAADMIN: undefined }),
    );
    expect(ctx.adminClient).toBeNull();
  });

  it('creates edsClient when imsToken present', async () => {
    const ctx = await buildChatContext(minimalBody({ imsToken: 'tok' }), minimalEnv());
    expect(ctx.edsClient).not.toBeNull();
  });

  it('edsClient is null without imsToken', async () => {
    const ctx = await buildChatContext(minimalBody(), minimalEnv());
    expect(ctx.edsClient).toBeNull();
  });

  it('builds sourceUrl from env and pageContext', async () => {
    const ctx = await buildChatContext(
      minimalBody({ pageContext: { org: 'adobe', site: 'docs', path: '/page' } }),
      minimalEnv(),
    );
    expect(ctx.sourceUrl).toContain('adobe');
    expect(ctx.sourceUrl).toContain('docs');
  });

  it('defaults daOrigin to https://admin.da.live', async () => {
    const ctx = await buildChatContext(minimalBody(), minimalEnv({ DA_ORIGIN: undefined }));
    expect(ctx.daOrigin).toBe('https://admin.da.live');
  });

  it('uses DA_ORIGIN from env when set', async () => {
    const ctx = await buildChatContext(
      minimalBody(),
      minimalEnv({ DA_ORIGIN: 'http://localhost:8787' }),
    );
    expect(ctx.daOrigin).toBe('http://localhost:8787');
  });

  it('populates attachmentMap from body attachments', async () => {
    const ctx = await buildChatContext(
      minimalBody({
        attachments: [
          { id: 'a1', fileName: 'img.png', mediaType: 'image/png', dataBase64: 'data' },
        ],
      }),
      minimalEnv(),
    );
    expect(ctx.attachmentMap.get('a1')?.fileName).toBe('img.png');
    expect(ctx.attachments).toHaveLength(1);
  });

  it('returns empty attachmentMap when no attachments', async () => {
    const ctx = await buildChatContext(minimalBody(), minimalEnv());
    expect(ctx.attachmentMap.size).toBe(0);
    expect(ctx.attachments).toHaveLength(0);
  });

  it('loads project memory when adminClient and pageContext available', async () => {
    const ctx = await buildChatContext(
      minimalBody({
        imsToken: 'tok',
        pageContext: { org: 'adobe', site: 'docs', path: '/p' },
      }),
      minimalEnv(),
    );
    expect(ctx.projectMemory).toBe('remembered stuff');
  });

  it('project memory is null without pageContext', async () => {
    const ctx = await buildChatContext(minimalBody({ imsToken: 'tok' }), minimalEnv());
    expect(ctx.projectMemory).toBeNull();
  });

  it('collab is null without pageContext', async () => {
    const ctx = await buildChatContext(minimalBody({ imsToken: 'tok' }), minimalEnv());
    expect(ctx.collab).toBeNull();
  });

  it('collab is null when createCollabClient throws', async () => {
    const { createCollabClient } = await import('../src/collab-client.js');
    vi.mocked(createCollabClient).mockRejectedValueOnce(new Error('WebSocket failed'));
    const ctx = await buildChatContext(
      minimalBody({
        imsToken: 'tok',
        pageContext: { org: 'adobe', site: 'docs', path: '/p', view: 'edit' },
      }),
      minimalEnv(),
    );
    expect(ctx.collab).toBeNull();
  });

  it('collab is null when connection times out', async () => {
    const { createCollabClient } = await import('../src/collab-client.js');
    vi.mocked(createCollabClient).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ disconnect: vi.fn() } as never), 10000);
        }),
    );
    vi.useFakeTimers();
    const promise = buildChatContext(
      minimalBody({
        imsToken: 'tok',
        pageContext: { org: 'adobe', site: 'docs', path: '/p', view: 'edit' },
      }),
      minimalEnv(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const ctx = await promise;
    expect(ctx.collab).toBeNull();
    vi.useRealTimers();
  });
});
