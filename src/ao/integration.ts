/**
 * AO integration facade.
 *
 * Orchestrates fetching plugins, skills, and MCP configs from a running
 * AO instance and adapting them for use in da-agent's pipeline.
 *
 * All operations are best-effort: AO being unavailable never blocks chat.
 */

import { AOMarketplaceClient } from './marketplace-client.js';
import type { AOPluginRecord } from './marketplace-client.js';
import { buildAOSkillsIndex, loadAOSkillBody, isAOSkill, parseAOSkillId } from './skill-adapter.js';
import type { SkillSummary } from '../skills/loader.js';
import { adaptAOMCPServers } from './mcp-adapter.js';
import type { RemoteMCPServerConfig } from '../mcp/types.js';

export interface AOContext {
  client: AOMarketplaceClient;
  plugins: AOPluginRecord[];
  skills: SkillSummary[];
  mcpServers: Record<string, RemoteMCPServerConfig>;
}

/**
 * Bootstrap AO integration: connect to the AO backend, fetch plugins,
 * build the skills index, and collect MCP server configs.
 *
 * Returns null if AO_BACKEND_URL is not set or AO is unreachable.
 */
export async function resolveAOContext(
  aoBackendUrl: string | undefined,
  imsToken?: string,
): Promise<AOContext | null> {
  if (!aoBackendUrl) return null;

  const client = new AOMarketplaceClient(aoBackendUrl, imsToken);

  try {
    const plugins = await client.listPlugins();
    const skills = buildAOSkillsIndex(plugins);

    let mcpServers: Record<string, RemoteMCPServerConfig> = {};
    try {
      const aoMcpServers = await client.getMCPServers();
      mcpServers = adaptAOMCPServers(aoMcpServers, imsToken);
    } catch {
      console.warn('[da-agent:ao] failed to fetch AO MCP servers');
    }

    console.log(
      `[da-agent:ao] resolved ${plugins.length} plugins, ` +
        `${skills.length} skills, ${Object.keys(mcpServers).length} MCP servers`,
    );

    return { client, plugins, skills, mcpServers };
  } catch (err) {
    console.warn('[da-agent:ao] AO unreachable, skipping integration:', err);
    return null;
  }
}

/**
 * Load a single AO skill body by its prefixed ID (e.g. `ao:dx-api/dx-api`).
 */
export async function resolveAOSkillBody(
  aoCtx: AOContext,
  skillId: string,
): Promise<string | null> {
  if (!isAOSkill(skillId)) return null;
  const parsed = parseAOSkillId(skillId);
  if (!parsed) return null;
  return loadAOSkillBody(aoCtx.client, parsed.plugin, parsed.skill);
}
