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
import { CORS_HEADERS, extractImsUserId } from './auth.js';
import {
  resolveApprovals,
  stripClientOnlyToolInputs,
  expandUserSelectionContextForModel,
  expandLatestUserAttachmentsForModel,
} from './message-pipeline.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { buildChatContext } from './chat-context.js';
import { resolveSkillsAndAgent } from './skill-resolver.js';
import { assembleTools } from './tool-assembly.js';

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
      return handleMcpToolsList(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Connect to the given MCP servers and list their individual tools.
 * Accepts POST { servers: { id: url, ... }, serverHeaders?: { id: [...] | { ... } } }.
 * Returns { servers: [{ id, tools: [{ name, description }], error? }] }.
 */
async function handleMcpToolsList(request: Request): Promise<Response> {
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

  const serverTools: Array<{
    id: string;
    tools: Array<{ name: string; description: string }>;
    error?: string;
  }> = [];

  const entries = Object.entries(parsed.data.servers);
  const clients: MCPClient[] = [];

  await Promise.all(
    entries.map(async ([serverId, serverUrl]) => {
      const headers = normalizeMcpHeadersInput(parsed.data.serverHeaders?.[serverId]);
      const client = new MCPClient(serverUrl, {
        timeout: 10000,
        ...(headers ? { headers } : {}),
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
    return new Response('Invalid JSON', { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response('Invalid request body', { status: 400 });
  }

  const ctx = await buildChatContext(parsed.data, env);

  const { skillsIndex, activeAgent, agentSkillContents, requestedSkillContents } =
    await resolveSkillsAndAgent(ctx, parsed.data);

  const { allTools, mcpClients, mcpConfig, generatedToolsIndex, builtInServers } =
    await assembleTools(ctx, env, parsed.data);

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
    ...(typeof a.sizeBytes === 'number' ? { sizeBytes: a.sizeBytes } : {}),
    ...(a.contentUrl ? { contentUrl: a.contentUrl } : {}),
  }));
  const modelMessages = expandLatestUserAttachmentsForModel(withSelectionContext, attachmentMeta);

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
    system: buildSystemPrompt(
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
    ),
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
