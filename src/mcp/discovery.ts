/**
 * MCP Discovery — scan a DA repo's `mcp-servers/` directory for MCP server
 * declarations, validate them, and produce a normalized overlay that can be
 * merged with the platform's system MCP config.
 */

import type { DAAdminClient } from '../da-admin/client.js';
import type {
  MCPServerConfig,
  DiscoveredMCP,
  MCPDiscoveryWarning,
  MCPServerStatus,
  EffectiveMCPConfig,
} from './types.js';
import { isStdioConfig, isRemoteConfig } from './types.js';

const SERVER_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_MCP_JSON_SIZE = 64 * 1024; // 64 KiB

const PLATFORM_SERVER_IDS = new Set([
  'playwright',
  'catalyst_ui',
]);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateServerId(id: string): string | null {
  if (!SERVER_ID_RE.test(id)) {
    return `Invalid serverId "${id}": must match ${SERVER_ID_RE}`;
  }
  if (PLATFORM_SERVER_IDS.has(id)) {
    return `Skipped: server id "${id}" reserved by platform MCP`;
  }
  return null;
}

function validateConfig(raw: unknown): { config: MCPServerConfig | null; error: string | null } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config: null, error: 'mcp.json must be a JSON object' };
  }

  const obj = raw as Record<string, unknown>;

  if ('type' in obj && (obj.type === 'http' || obj.type === 'sse')) {
    if (typeof obj.url !== 'string' || !obj.url) {
      return { config: null, error: `Remote MCP config (${obj.type}) requires a "url" string` };
    }
    const remote: MCPServerConfig = {
      type: obj.type as 'http' | 'sse',
      url: obj.url,
      ...(obj.headers && typeof obj.headers === 'object' ? { headers: obj.headers as Record<string, string> } : {}),
    };
    return { config: remote, error: null };
  }

  if (typeof obj.command === 'string' && obj.command) {
    const stdio: MCPServerConfig = {
      command: obj.command,
      ...(Array.isArray(obj.args) ? { args: obj.args as string[] } : {}),
      ...(obj.env && typeof obj.env === 'object' ? { env: obj.env as Record<string, string> } : {}),
      ...(typeof obj.cwd === 'string' ? { cwd: obj.cwd } : {}),
    };
    return { config: stdio, error: null };
  }

  return { config: null, error: 'mcp.json must specify either "command" (stdio) or "type"+"url" (remote)' };
}

function resolveRelativeUrl(
  url: string,
  siteOrigin: string | undefined,
): { resolved: string; error: string | null } {
  try {
    new URL(url);
    return { resolved: url, error: null };
  } catch {
    // relative — needs a base
  }
  if (!siteOrigin) {
    return { resolved: url, error: 'Relative URL requires a configured site origin (siteUrl)' };
  }
  try {
    const resolved = new URL(url, siteOrigin).href;
    return { resolved, error: null };
  } catch {
    return { resolved: url, error: `Could not resolve relative URL "${url}" against "${siteOrigin}"` };
  }
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export interface ScanOptions {
  siteOrigin?: string;
  workspacePath?: string;
}

/**
 * Scan `mcp-servers/` under `{org}/{repo}` for MCP server declarations.
 * Returns a `DiscoveredMCP` cache object ready to be written to
 * `.da/discovered-mcp.json`.
 */
export async function scanRepoMCPServers(
  client: DAAdminClient,
  org: string,
  repo: string,
  options: ScanOptions = {},
): Promise<DiscoveredMCP> {
  const mcpServers: Record<string, MCPServerConfig> = {};
  const warnings: MCPDiscoveryWarning[] = [];
  const servers: MCPServerStatus[] = [];

  let listing;
  try {
    listing = await client.listSources(org, repo, 'mcp-servers');
  } catch {
    return {
      readAt: new Date().toISOString(),
      mcpServers,
      warnings: [{ serverId: '*', message: 'mcp-servers/ directory not found or not accessible' }],
      servers,
    };
  }

  const dirs = (listing.sources ?? []).filter((s) => s.type === 'directory');
  if (dirs.length === 0) {
    return {
      readAt: new Date().toISOString(),
      mcpServers,
      warnings: [{ serverId: '*', message: 'mcp-servers/ contains no subdirectories' }],
      servers,
    };
  }

  for (const dir of dirs) {
    const serverId = dir.name.replace(/\/$/, '');

    const idError = validateServerId(serverId);
    if (idError) {
      warnings.push({ serverId, message: idError });
      servers.push({ id: serverId, sourcePath: dir.path, status: 'error' });
      continue;
    }

    const mcpJsonPath = `mcp-servers/${serverId}/mcp.json`;
    let raw: string;
    try {
      const source = await client.getSource(org, repo, mcpJsonPath);
      if (typeof source === 'string') {
        raw = source;
      } else {
        raw = source.content ?? JSON.stringify(source);
      }
    } catch {
      warnings.push({ serverId, message: `Could not read ${mcpJsonPath}` });
      servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'error' });
      continue;
    }

    if (raw.length > MAX_MCP_JSON_SIZE) {
      warnings.push({ serverId, message: `${mcpJsonPath} exceeds 64 KiB size limit` });
      servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'error' });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push({ serverId, message: `${mcpJsonPath} is not valid JSON` });
      servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'error' });
      continue;
    }

    const { config, error } = validateConfig(parsed);
    if (!config || error) {
      warnings.push({ serverId, message: error ?? 'Unknown validation error' });
      servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'error' });
      continue;
    }

    if (isRemoteConfig(config)) {
      const { resolved, error: urlError } = resolveRelativeUrl(config.url, options.siteOrigin);
      if (urlError) {
        warnings.push({ serverId, message: urlError });
        servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'error' });
        continue;
      }
      config.url = resolved;
    }

    if (isStdioConfig(config) && !config.cwd) {
      const base = options.workspacePath
        ? `${options.workspacePath.replace(/\/$/, '')}/mcp-servers/${serverId}`
        : `mcp-servers/${serverId}`;
      config.cwd = base;
    }

    mcpServers[serverId] = config;
    servers.push({ id: serverId, sourcePath: mcpJsonPath, status: 'ok' });
  }

  return {
    readAt: new Date().toISOString(),
    mcpServers,
    warnings,
    servers,
  };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge system (platform) and repo MCP configs.
 * System keys always win over repo keys with the same id.
 */
export function loadEffectiveMCPConfig(
  systemConfig: Record<string, MCPServerConfig>,
  repoOverlay: DiscoveredMCP | null,
): EffectiveMCPConfig {
  if (!repoOverlay || Object.keys(repoOverlay.mcpServers).length === 0) {
    return {
      mcpServers: { ...systemConfig },
      toolAllowPatterns: Object.keys(systemConfig).map((id) => `mcp__${id}__*`),
    };
  }

  const repoOnlyKeys: Record<string, MCPServerConfig> = {};
  for (const [id, config] of Object.entries(repoOverlay.mcpServers)) {
    if (!(id in systemConfig)) {
      repoOnlyKeys[id] = config;
    }
  }

  const merged: Record<string, MCPServerConfig> = {
    ...repoOnlyKeys,
    ...systemConfig,
  };

  return {
    mcpServers: merged,
    toolAllowPatterns: Object.keys(merged).map((id) => `mcp__${id}__*`),
  };
}

// ---------------------------------------------------------------------------
// Cache I/O via DAAdminClient
// ---------------------------------------------------------------------------

const CACHE_PATH = '.da/discovered-mcp.json';

/**
 * Read the cached discovery result from `.da/discovered-mcp.json`.
 * Returns `null` if the cache does not exist or is unreadable.
 */
export async function readDiscoveryCache(
  client: DAAdminClient,
  org: string,
  repo: string,
): Promise<DiscoveredMCP | null> {
  try {
    const source = await client.getSource(org, repo, CACHE_PATH);
    const raw = typeof source === 'string' ? source : source.content;
    return JSON.parse(raw) as DiscoveredMCP;
  } catch {
    return null;
  }
}
