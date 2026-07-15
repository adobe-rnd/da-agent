import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { initTelemetry, flushTelemetry } from './telemetry.js';
import { MCPClient } from './mcp/client.js';
import {
  buildApprovalContinuationResponse,
  getNewlyResolvedToolOutputs,
  hasPendingApprovals,
} from './tool-approval.js';
import {
  detectSessionUserPattern,
  trailingAssistantAlreadySuggestedSkill,
} from './user-message-pattern.js';
import {
  ChatRequestSchema,
  McpToolsRequestSchema,
  normalizeMcpHeadersInput,
} from './request-schemas.js';
import { CORS_HEADERS, DA_OAUTH_CLIENT_ID, extractImsUserId } from './auth.js';
import { handleMCPRequest } from './mcp-server/handler.js';
import { createDAMCPRegistry } from './mcp-server/da-registry.js';
import { createEDSMCPRegistry } from './mcp-server/eds-registry.js';
import { parseTrustedDomains, isUrlTrustedForToken } from './mcp/token-allowlist.js';
import {
  resolveApprovals,
  stripClientOnlyToolInputs,
  expandUserSelectionContextForModel,
  expandLatestUserAttachmentsForModel,
} from './message-pipeline.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { buildEarlyChatContext, resolveAsyncContext } from './chat-context.js';
import { resolveSkillsAndAgent } from './skill-resolver.js';
import { assembleTools, type CollabRef } from './tool-assembly.js';
import {
  resolveCompactThreshold,
  shouldAutoCompact,
  buildAutoCompactSection,
  createCompactTools,
  COMPACT_SKILL,
} from './compact.js';

/** Loggable streamText / provider errors (Error#cause chains, non-enumerable fields). */
function formatErrorForLog(err: unknown): string {
  if (err instanceof Error) {
    const lines = [err.message];
    if (err.stack) lines.push(err.stack);
    let c: unknown = err.cause;
    let depth = 0;
    while (c instanceof Error && depth < 6) {
      lines.push(`Caused by: ${c.message}`);
      c = c.cause;
      depth += 1;
    }
    return lines.join('\n');
  }
  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname === '/chat') {
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: CORS_HEADERS });
      }
      if (request.method === 'POST') {
        return handleChat(request, env);
      }
    }

    if (url.pathname === '/mcp-tools' && request.method === 'POST') {
      return handleMcpToolsList(request, env);
    }

    // CMA plugin surface: DA content tools (da-tools bundle).
    if (url.pathname === '/mcp/da' && request.method === 'POST') {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token) {
        return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
      }
      if (!env.DAADMIN) {
        return new Response(JSON.stringify({ error: 'DA Admin service binding not configured' }), {
          status: 503,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      return handleMCPRequest(
        request,
        createDAMCPRegistry(token, env.DAADMIN, {
          dacollab: env.DACOLLAB,
          daOrigin: env.DA_ORIGIN,
        }),
      );
    }

    // CMA plugin surface: EDS preview/publish tools (eds-preview bundle).
    if (url.pathname === '/mcp/eds' && request.method === 'POST') {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token) {
        return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
      }
      return handleMCPRequest(request, createEDSMCPRegistry(token));
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Connect to the given MCP servers and list their individual tools.
 * Accepts POST { servers: { id: url, ... }, serverHeaders?: { id: [...] | { ... } } }.
 * Returns { servers: [{ id, tools: [{ name, description }], error? }] }.
 */
async function handleMcpToolsList(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS });
  }

  const parsed = McpToolsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      'Expected { servers: Record<string, string>, serverHeaders?: Record<string, headerList | headerMap> }',
      {
        status: 400,
        headers: CORS_HEADERS,
      },
    );
  }

  const { imsToken } = parsed.data;
  const trustedDomains = parseTrustedDomains(env.TRUSTED_MCP_DOMAINS);

  const serverTools: Array<{
    id: string;
    tools: Array<{ name: string; description: string }>;
    error?: string;
  }> = [];

  const entries = Object.entries(parsed.data.servers);
  const clients: MCPClient[] = [];

  await Promise.all(
    entries.map(async ([serverId, serverUrl]) => {
      const mergedHeaders: Record<string, string> = {
        ...(normalizeMcpHeadersInput(parsed.data.serverHeaders?.[serverId]) ?? {}),
      };

      if (imsToken && isUrlTrustedForToken(serverUrl, trustedDomains)) {
        mergedHeaders.Authorization = `Bearer ${imsToken}`;
        mergedHeaders['x-api-key'] = DA_OAUTH_CLIENT_ID;
      }

      const client = new MCPClient(serverUrl, {
        timeout: 10000,
        ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
      });
      try {
        await client.initialize();
        clients.push(client);
        const tools = await client.listTools();
        serverTools.push({
          id: serverId,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? `Tool from ${serverId}`,
          })),
        });
      } catch (e) {
        serverTools.push({
          id: serverId,
          tools: [],
          error: `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),
  );

  await Promise.allSettled(clients.map((c) => c.close()));

  return new Response(JSON.stringify({ servers: serverTools }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  initTelemetry(env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response('Invalid request body', { status: 400, headers: CORS_HEADERS });
  }

  const t0 = Date.now();

  // Phase 1 (sync): build adminClient, pageContext, attachments — no I/O.
  const early = buildEarlyChatContext(parsed.data, env);
  const t1 = Date.now();

  // Phase 2 (parallel): collab+memory, skills, MCP+tools all run concurrently.
  // DA tools await collabRef.promise at execution time (during the LLM stream).
  const asyncCtxPromise = resolveAsyncContext(early, env);
  const collabRef: CollabRef = { promise: asyncCtxPromise.then((c) => c.collab) };

  const [ctx, { skillsIndex, activeAgent, agentSkillContents, requestedSkillContents }, assembled] =
    await Promise.all([
      asyncCtxPromise,
      resolveSkillsAndAgent(early, parsed.data),
      assembleTools(early, env, parsed.data, collabRef),
    ]);
  const t2 = Date.now();

  const { allTools, mcpClients, mcpConfig, mcpErrors, generatedToolsIndex, builtInServers } =
    assembled;

  console.log(`[da-agent:perf] early=${t1 - t0}ms parallel=${t2 - t1}ms pre-stream=${t2 - t0}ms`);

  const { messages, requestedSkills, imsToken, attachments = [], sessionId } = parsed.data;

  const cleanupMCP = () => {
    mcpClients.forEach((c) => {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    });
  };

  const processedMessages = await resolveApprovals(messages, allTools);

  if (hasPendingApprovals(processedMessages)) {
    const toolOutputs = getNewlyResolvedToolOutputs(messages, processedMessages);
    cleanupMCP();
    ctx.collab?.disconnect();
    await flushTelemetry();
    return buildApprovalContinuationResponse(toolOutputs, CORS_HEADERS);
  }

  const strippedForModel = stripClientOnlyToolInputs(processedMessages);
  const sessionPattern = trailingAssistantAlreadySuggestedSkill(strippedForModel)
    ? null
    : detectSessionUserPattern(strippedForModel);
  const withSelectionContext = expandUserSelectionContextForModel(strippedForModel);
  const attachmentMeta = attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mediaType: a.mediaType,
    ...(a.dataBase64 ? { dataBase64: a.dataBase64 } : {}),
    ...(typeof a.sizeBytes === 'number' ? { sizeBytes: a.sizeBytes } : {}),
    ...(a.contentUrl ? { contentUrl: a.contentUrl } : {}),
  }));
  const modelMessages = expandLatestUserAttachmentsForModel(withSelectionContext, attachmentMeta);

  // Auto-compact: check token usage against threshold, inject skill + tool if triggered.
  const compactThreshold = resolveCompactThreshold(env.COMPACT_THRESHOLD_OVERRIDE);
  let effectiveSkillContents = agentSkillContents;

  const baseSystemPrompt = buildSystemPrompt(
    ctx.pageContext,
    mcpConfig,
    skillsIndex,
    activeAgent,
    agentSkillContents,
    generatedToolsIndex,
    ctx.projectMemory,
    sessionPattern,
    env.ENVIRONMENT,
    builtInServers,
    {
      contents: requestedSkillContents,
      missing: (requestedSkills ?? []).filter((id) => !requestedSkillContents[id]),
    },
    mcpErrors,
  );

  const autoCompact = shouldAutoCompact(modelMessages, baseSystemPrompt, compactThreshold);
  const userRequestedCompact = requestedSkills?.includes('compact');

  let systemPrompt = baseSystemPrompt;
  if (autoCompact || userRequestedCompact) {
    effectiveSkillContents = { ...agentSkillContents, _compact_: COMPACT_SKILL };
    Object.assign(allTools, createCompactTools());
    systemPrompt = buildSystemPrompt(
      ctx.pageContext,
      mcpConfig,
      skillsIndex,
      activeAgent,
      effectiveSkillContents,
      generatedToolsIndex,
      ctx.projectMemory,
      sessionPattern,
      env.ENVIRONMENT,
      builtInServers,
      {
        contents: requestedSkillContents,
        missing: (requestedSkills ?? []).filter((id) => !requestedSkillContents[id]),
      },
      mcpErrors,
    );
    if (autoCompact) systemPrompt += buildAutoCompactSection(compactThreshold);
  }

  const bedrock = createAmazonBedrock({
    region: env.AWS_REGION,
    apiKey: env.AWS_BEARER_TOKEN_BEDROCK,
  });

  const result = streamText({
    model: bedrock('global.anthropic.claude-sonnet-4-6'),
    onError: (error) => {
      console.error('[da-agent] streamText error:', formatErrorForLog(error));
      ctx.collab?.disconnect();
      cleanupMCP();
    },
    onFinish: async () => {
      await flushTelemetry();
      ctx.collab?.disconnect();
      cleanupMCP();
    },
    system: systemPrompt,
    messages: modelMessages as ModelMessage[],
    tools: allTools,
    stopWhen: stepCountIs(5),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'da-agent-chat',
      metadata: {
        userId: extractImsUserId(imsToken) ?? 'unknown',
        org: ctx.pageContext?.org ?? 'unknown',
        site: ctx.pageContext?.site ?? 'unknown',
        path: ctx.pageContext?.path ?? 'unknown',
        sessionId,
      },
    },
  });

  const streamResponse = result.toUIMessageStreamResponse();

  const headers = new Headers(streamResponse.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers,
  });
}
