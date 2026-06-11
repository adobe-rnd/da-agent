/**
 * Adapts AO plugin MCP server configs into DA's RemoteMCPServerConfig format.
 *
 * AO plugins bundle `.mcp.json` with multi-transport configs and rich auth
 * providers. DA only supports HTTP/SSE transports with optional headers.
 * This adapter:
 * - Filters to streamable_http and sse transports (DA-compatible)
 * - Maps AO passthrough auth to DA's header-based auth
 * - Prefixes server IDs with `ao:` to avoid collision
 */

import type { RemoteMCPServerConfig } from '../mcp/types.js';
import type { AOMCPServer } from './marketplace-client.js';

export const AO_MCP_PREFIX = 'ao:';

export function aoMcpServerId(serverName: string): string {
  return `${AO_MCP_PREFIX}${serverName}`;
}

/**
 * Convert AO MCP server configs to DA-compatible RemoteMCPServerConfig entries.
 * Filters out stdio servers (unsupported in Cloudflare Workers).
 */
export function adaptAOMCPServers(
  aoServers: AOMCPServer[],
  imsToken?: string,
): Record<string, RemoteMCPServerConfig> {
  const result: Record<string, RemoteMCPServerConfig> = {};

  for (const server of aoServers) {
    if (server.transport !== 'stdio' && server.source) {
      const daType = server.transport === 'streamable_http' ? 'http' : 'sse';
      const headers: Record<string, string> = {};

      if (imsToken && server.auth) {
        headers.Authorization = `Bearer ${imsToken}`;
      }

      result[aoMcpServerId(server.name)] = {
        type: daType,
        url: server.source,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
  }

  return result;
}
