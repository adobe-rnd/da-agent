import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleTools } from '../src/tool-assembly.js';
import type { ChatContext } from '../src/chat-context.js';

vi.mock('../src/tools/tools.js', () => ({
  createDATools: vi.fn(() => ({ content_list: { description: 'list' } })),
  createEDSTools: vi.fn(() => ({ content_preview: { description: 'preview' } })),
  createCanvasClientTools: vi.fn(() => ({ canvas_open: { description: 'open' } })),
}));

vi.mock('../src/mcp/tool-adapter.js', () => ({
  connectAndRegisterMCPTools: vi.fn(async (mcpConfig) => {
    const tools: Record<string, { description: string }> = {};
    for (const id of Object.keys(mcpConfig.mcpServers)) {
      tools[`mcp__${id}__check`] = { description: 'check' };
    }
    return { tools, clients: [{ close: vi.fn() }] };
  }),
}));

vi.mock('../src/mcp/built-in-servers.js', () => ({
  getBuiltInMcpServers: vi.fn(() => ({
    'governance-agent': {
      type: 'http',
      url: 'https://gov.example.com/mcp/',
      sendImsToken: true,
      instructions: 'Use Live Preview URL',
    },
  })),
}));

vi.mock('../src/generated-tools/loader.js', () => ({
  loadGeneratedTools: vi.fn(async () => ({
    index: { tools: [], source: 'none' },
    approved: [],
  })),
}));

vi.mock('../src/generated-tools/sandbox-client.js', () => ({
  callSandbox: vi.fn(),
}));

vi.mock('../src/tools/tool-overrides.js', () => ({
  loadDisabledTools: vi.fn(async () => new Set<string>()),
  applyToolOverrides: vi.fn(() => []),
}));

function mockCtx(overrides?: Partial<ChatContext>): ChatContext {
  return {
    pageContext: { org: 'adobe', site: 'docs', path: '/index.html' },
    imsToken: 'tok',
    daOrigin: 'https://admin.da.live',
    sourceUrl: 'https://admin.da.live/source/adobe/docs/index.html',
    adminClient: { getSiteConfig: vi.fn() } as unknown as ChatContext['adminClient'],
    edsClient: {} as ChatContext['edsClient'],
    collab: null,
    attachmentMap: new Map(),
    attachments: [],
    projectMemory: null,
    ...overrides,
  };
}

function minimalEnv(overrides?: Record<string, unknown>): Env {
  return {
    AWS_BEARER_TOKEN_BEDROCK: 'token',
    LANGFUSE_PUBLIC_KEY: 'pub',
    LANGFUSE_SECRET_KEY: 'sec',
    ENVIRONMENT: 'production',
    ...overrides,
  } as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assembleTools', () => {
  it('merges DA, EDS, and canvas tools', async () => {
    const { allTools } = await assembleTools(mockCtx(), minimalEnv(), {});
    expect(allTools).toHaveProperty('content_list');
    expect(allTools).toHaveProperty('content_preview');
    expect(allTools).toHaveProperty('canvas_open');
  });

  it('includes MCP tools from built-in servers', async () => {
    const { allTools, mcpClients } = await assembleTools(mockCtx(), minimalEnv(), {});
    expect(allTools).toHaveProperty('mcp__governance-agent__check');
    expect(mcpClients).toHaveLength(1);
  });

  it('builds mcpConfig with built-in servers', async () => {
    const { mcpConfig } = await assembleTools(mockCtx(), minimalEnv(), {});
    expect(mcpConfig).not.toBeNull();
    expect(mcpConfig!.mcpServers).toHaveProperty('governance-agent');
  });

  it('merges user-provided MCP servers into config', async () => {
    const { mcpConfig } = await assembleTools(mockCtx(), minimalEnv(), {
      mcpServers: { 'my-mcp': 'https://mymcp.example.com' },
    });
    expect(mcpConfig!.mcpServers).toHaveProperty('my-mcp');
    expect(mcpConfig!.mcpServers).toHaveProperty('governance-agent');
  });

  it('injects auth headers into built-in servers when imsToken present', async () => {
    const { mcpConfig } = await assembleTools(mockCtx(), minimalEnv(), {});
    const govServer = mcpConfig!.mcpServers['governance-agent'];
    expect((govServer as Record<string, unknown>).headers).toHaveProperty('Authorization');
  });

  it('returns builtInServers for prompt building', async () => {
    const { builtInServers } = await assembleTools(mockCtx(), minimalEnv(), {});
    expect(builtInServers).toHaveProperty('governance-agent');
  });

  it('returns generatedToolsIndex', async () => {
    const { generatedToolsIndex } = await assembleTools(mockCtx(), minimalEnv(), {});
    expect(generatedToolsIndex.source).toBe('none');
  });

  it('creates no MCP clients without servers', async () => {
    vi.mocked(await import('../src/mcp/built-in-servers.js')).getBuiltInMcpServers.mockReturnValue(
      {},
    );
    const { mcpClients, mcpConfig } = await assembleTools(
      mockCtx({ imsToken: undefined }),
      minimalEnv(),
      {},
    );
    expect(mcpConfig).toBeNull();
    expect(mcpClients).toHaveLength(0);
  });

  it('skips EDS tools when edsClient is null', async () => {
    const { allTools } = await assembleTools(mockCtx({ edsClient: null }), minimalEnv(), {});
    expect(allTools).not.toHaveProperty('content_preview');
  });
});
