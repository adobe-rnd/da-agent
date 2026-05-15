/**
 * Tool registry builder: creates DA/EDS/canvas tools, connects MCP servers
 * (built-in + user), loads generated tool stubs, and applies tool overrides.
 */

import type { MCPServerConfig, BuiltInMCPServerConfig } from './mcp/types.js';
import { createCanvasClientTools, createDATools, createEDSTools } from './tools/tools.js';
import { connectAndRegisterMCPTools } from './mcp/tool-adapter.js';
import { MCPClient } from './mcp/client.js';
import {
  loadApprovedGeneratedTools,
  loadGeneratedToolsIndex,
  type GeneratedToolsIndex,
} from './generated-tools/loader.js';
import { callSandbox } from './generated-tools/sandbox-client.js';
import { loadDisabledTools, applyToolOverrides } from './tools/tool-overrides.js';
import { normalizeMcpHeadersInput } from './request-schemas.js';
import { DA_OAUTH_CLIENT_ID } from './auth.js';
import { getBuiltInMcpServers } from './mcp/built-in-servers.js';
import type { ChatContext } from './chat-context.js';

export interface AssembledTools {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  allTools: Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  mcpClients: MCPClient[];
  mcpConfig: { mcpServers: Record<string, MCPServerConfig>; toolAllowPatterns: string[] } | null;
  generatedToolsIndex: GeneratedToolsIndex;
  builtInServers: Record<string, BuiltInMCPServerConfig>;
}

export async function assembleTools(
  ctx: ChatContext,
  env: Env,
  body: {
    mcpServers?: Record<string, string>;
    mcpServerHeaders?: Record<string, unknown>;
  },
): Promise<AssembledTools> {
  const { adminClient, edsClient, collab, pageContext, imsToken, attachmentMap } = ctx;

  const daTools = createDATools(adminClient, {
    pageContext: pageContext ?? undefined,
    collab: collab ?? undefined,
    org: pageContext?.org,
    repo: pageContext?.site,
    resolveAttachmentByRef: (attachmentRef: string) => {
      const hit = attachmentMap.get(attachmentRef);
      if (!hit?.dataBase64) return null;
      return {
        base64Data: hit.dataBase64,
        mimeType: hit.mediaType,
        fileName: hit.fileName,
      };
    },
  });
  const edsTools = edsClient ? createEDSTools(edsClient) : {};
  const canvasClientTools = createCanvasClientTools();

  // Build MCP config: user-provided servers merged with always-on built-in servers.
  const allMcpServers: Record<string, MCPServerConfig> = {};

  for (const [id, url] of Object.entries(body.mcpServers ?? {})) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = normalizeMcpHeadersInput((body.mcpServerHeaders as any)?.[id]);
    allMcpServers[id] = {
      type: 'http',
      url,
      ...(headers ? { headers } : {}),
    };
  }

  const builtInServers = getBuiltInMcpServers(env);

  for (const [id, builtIn] of Object.entries(builtInServers)) {
    const headers: Record<string, string> = {};
    if (builtIn.sendImsToken && imsToken) {
      headers.Authorization = `Bearer ${imsToken}`;
      headers['x-api-key'] = DA_OAUTH_CLIENT_ID;
    }
    allMcpServers[id] = {
      type: builtIn.type,
      url: builtIn.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  const mcpConfig =
    Object.keys(allMcpServers).length > 0
      ? {
          mcpServers: allMcpServers,
          toolAllowPatterns: Object.keys(allMcpServers).map((id) => `mcp__${id}__*`),
        }
      : null;

  // Connect to live MCP servers and register their tools
  let mcpTools: Record<string, unknown> = {};
  let mcpClients: MCPClient[] = [];
  if (mcpConfig && Object.keys(mcpConfig.mcpServers).length > 0) {
    try {
      const mcpResult = await connectAndRegisterMCPTools(mcpConfig);
      mcpTools = mcpResult.tools;
      mcpClients = mcpResult.clients;
    } catch {
      // MCP connection failures don't block chat
    }
  }

  // Load approved generated tool defs and register stubs (execution delegates to sandbox).
  let generatedToolsIndex: GeneratedToolsIndex = { tools: [], source: 'none' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatedToolStubs: Record<string, any> = {};
  if (adminClient && pageContext && env.GENERATED_TOOLS_ENABLED === 'true') {
    try {
      generatedToolsIndex = await loadGeneratedToolsIndex(
        adminClient,
        pageContext.org,
        pageContext.site,
      );
      const activeDefs = await loadApprovedGeneratedTools(
        adminClient,
        pageContext.org,
        pageContext.site,
      );
      const sandboxUrl: string | undefined = env.GENERATED_TOOLS_SANDBOX_URL;
      activeDefs.forEach((def) => {
        const toolName = `gen__${def.id}`;
        generatedToolStubs[toolName] = {
          description: def.description,
          parameters: def.inputSchema,
          execute: async (args: Record<string, unknown>) =>
            callSandbox(sandboxUrl, {
              toolId: def.id,
              org: pageContext.org,
              site: pageContext.site,
              args,
              imsToken: imsToken ?? undefined,
            }),
        };
      });
    } catch {
      // Generated tools loading is best-effort; never blocks chat
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, any> = {
    ...canvasClientTools,
    ...daTools,
    ...edsTools,
    ...mcpTools,
    ...generatedToolStubs,
  };

  if (adminClient && pageContext) {
    const disabled = await loadDisabledTools(adminClient, pageContext.org, pageContext.site);
    if (disabled.size > 0) {
      const removed = applyToolOverrides(allTools, disabled);
      if (removed.length > 0) {
        console.log('[da-agent] tool overrides removed:', removed);
      }
    }
  }

  return { allTools, mcpClients, mcpConfig, generatedToolsIndex, builtInServers };
}
