// test/telemetry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available when vi.mock factory functions run
const {
  mockSetGlobalTracerProvider,
  mockBasicTracerProvider,
  mockForceFlush,
  mockLangfuseExporter,
} = vi.hoisted(() => {
  const _forceFlush = vi.fn().mockResolvedValue(undefined);
  const _langfuseExporter = vi.fn(() => ({ forceFlush: _forceFlush }));
  const _basicTracerProvider = vi.fn(() => ({}));
  const _setGlobalTracerProvider = vi.fn();
  return {
    mockSetGlobalTracerProvider: _setGlobalTracerProvider,
    mockBasicTracerProvider: _basicTracerProvider,
    mockForceFlush: _forceFlush,
    mockLangfuseExporter: _langfuseExporter,
  };
});

vi.mock('@opentelemetry/api', () => ({
  trace: { setGlobalTracerProvider: mockSetGlobalTracerProvider },
}));

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BasicTracerProvider: mockBasicTracerProvider,
  SimpleSpanProcessor: vi.fn((exporter) => ({ exporter })),
}));

vi.mock('langfuse-vercel', () => ({
  LangfuseExporter: mockLangfuseExporter,
}));

describe('telemetry', () => {
  let initTelemetry: (env: Partial<Env>) => void;
  let flushTelemetry: () => Promise<void>;
  let buildChatTelemetryMetadata: typeof import('../src/telemetry.js').buildChatTelemetryMetadata;
  let getChatTelemetryFunctionId: typeof import('../src/telemetry.js').getChatTelemetryFunctionId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Re-import to reset the module-level `initialized` and `exporter` state
    const mod = await import('../src/telemetry.js');
    initTelemetry = mod.initTelemetry as (env: Partial<Env>) => void;
    flushTelemetry = mod.flushTelemetry;
    buildChatTelemetryMetadata = mod.buildChatTelemetryMetadata;
    getChatTelemetryFunctionId = mod.getChatTelemetryFunctionId;
  });

  it('registers provider when credentials are present', () => {
    initTelemetry({ LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' } as Env);

    expect(mockLangfuseExporter).toHaveBeenCalledWith({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: 'https://mystique-langfuse-prod.corp.ethos117-prod-va6.ethos.adobe.net/',
    });
    expect(mockBasicTracerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        spanProcessors: [expect.objectContaining({ exporter: expect.any(Object) })],
      }),
    );
    expect(mockSetGlobalTracerProvider).toHaveBeenCalledOnce();
  });

  it('uses custom LANGFUSE_BASEURL when provided', () => {
    initTelemetry({
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASEURL: 'https://us.cloud.langfuse.com',
    } as Env);

    expect(mockLangfuseExporter).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://us.cloud.langfuse.com' }),
    );
  });

  it('skips registration when LANGFUSE_PUBLIC_KEY is missing', () => {
    initTelemetry({ LANGFUSE_SECRET_KEY: 'sk-test' } as Env);
    expect(mockSetGlobalTracerProvider).not.toHaveBeenCalled();
  });

  it('skips registration when LANGFUSE_SECRET_KEY is missing', () => {
    initTelemetry({ LANGFUSE_PUBLIC_KEY: 'pk-test' } as Env);
    expect(mockSetGlobalTracerProvider).not.toHaveBeenCalled();
  });

  it('only registers the provider once (initialized guard)', () => {
    const env = { LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' } as Env;
    initTelemetry(env);
    initTelemetry(env);
    initTelemetry(env);
    expect(mockSetGlobalTracerProvider).toHaveBeenCalledOnce();
  });

  it('missing credentials do not set initialized — a later call with valid credentials still registers', () => {
    const noKeys = {} as Env;
    const withKeys = { LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' } as Env;
    initTelemetry(noKeys);
    initTelemetry(withKeys);
    expect(mockSetGlobalTracerProvider).toHaveBeenCalledOnce();
  });

  it('flushTelemetry calls forceFlush on the exporter after init', async () => {
    initTelemetry({ LANGFUSE_PUBLIC_KEY: 'pk-test', LANGFUSE_SECRET_KEY: 'sk-test' } as Env);
    await flushTelemetry();
    expect(mockForceFlush).toHaveBeenCalledOnce();
  });

  it('flushTelemetry is a no-op when credentials were missing', async () => {
    initTelemetry({} as Env);
    await expect(flushTelemetry()).resolves.toBeUndefined();
    expect(mockForceFlush).not.toHaveBeenCalled();
  });

  it('builds backward-compatible metadata with richer aggregation dimensions', () => {
    const metadata = buildChatTelemetryMetadata({
      userId: '12345',
      org: 'adobe',
      site: 'da-agent',
      path: '/docs/index',
      view: 'edit',
      sessionId: 'session-1',
      environment: 'stage',
      agentId: 'seo-agent',
      requestedSkills: ['compact', 'seo', 'seo'],
      toolNames: ['content_update', 'search_docs', 'content_update'],
      attachmentCount: 2,
      mcpServerCount: 1,
      builtInServerCount: 3,
      generatedToolCount: 4,
      autoCompact: true,
    });

    expect(metadata).toMatchObject({
      userId: '12345',
      org: 'adobe',
      site: 'da-agent',
      path: '/docs/index',
      sessionId: 'session-1',
      telemetryVersion: 2,
      functionId: 'da-agent-chat',
      environment: 'stage',
      view: 'edit',
      entryPoint: 'agent',
      primarySkill: 'compact',
      skillCount: 2,
      requestedSkills: ['compact', 'seo'],
      agentId: 'seo-agent',
      toolCount: 2,
      toolNames: ['content_update', 'search_docs'],
      attachmentCount: 2,
      mcpServerCount: 1,
      builtInServerCount: 3,
      generatedToolCount: 4,
      autoCompact: true,
      hasPageContext: true,
    });
  });

  it('preserves the existing telemetry function id for dashboard compatibility', () => {
    expect(getChatTelemetryFunctionId()).toBe('da-agent-chat');
  });
});
