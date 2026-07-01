/**
 * Loader for generated tool definitions stored at .da/generated-tools/<id>.json.
 * Mirrors the skills loader pattern: site-scoped with org-level fallback.
 *
 * Generated tools are authored by the model or developers, stored as JSON,
 * and require explicit user approval before the agent registers them.
 * They are NOT executed inside da-agent — approved defs are registered as
 * stub tool() entries that delegate to the external sandbox Worker.
 */

import type { DAAdminClient } from '../da-admin/client.js';

export type ToolStatus = 'draft' | 'approved' | 'deprecated';
export type ToolCapability = 'read-only' | 'read-write';

export interface GeneratedToolSummary {
  id: string;
  name: string;
  description: string;
  status: ToolStatus;
  capability: ToolCapability;
}

export interface GeneratedToolDef extends GeneratedToolSummary {
  inputSchema: Record<string, unknown>;
  implementation: {
    type: 'da-api-sequence';
    steps: Array<{ tool: string; args: Record<string, unknown> }>;
  };
  createdBy: 'model' | 'developer';
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  promotedToSkill: string | null;
}

export interface GeneratedToolsIndex {
  tools: GeneratedToolSummary[];
  source: 'site' | 'org' | 'none';
}

interface ListItem {
  name: string;
  path: string;
  ext?: string;
}

const GENERATED_TOOLS_SUB_PATH = '.da/generated-tools';

/**
 * List JSON files in the generated-tools directory.
 * Tries site-scoped first, falls back to org-level.
 */
async function listToolFiles(
  client: DAAdminClient,
  org: string,
  site: string,
): Promise<{ items: ListItem[]; source: 'site' | 'org' | 'none' }> {
  const toItems = (resp: unknown): ListItem[] => (Array.isArray(resp) ? resp : []) as ListItem[];
  const filterJson = (items: ListItem[]) =>
    items.filter((i) => i.ext === 'json' || i.name?.endsWith('.json'));

  if (site) {
    try {
      const resp = await client.listSources(org, site, GENERATED_TOOLS_SUB_PATH);
      const items = filterJson(toItems(resp));
      if (items.length > 0) return { items, source: 'site' };
    } catch {
      // fall through to org
    }
  }

  try {
    const resp = await client.listSources(org, org, GENERATED_TOOLS_SUB_PATH);
    const items = filterJson(toItems(resp));
    if (items.length > 0) return { items, source: 'org' };
  } catch {
    // unavailable
  }

  return { items: [], source: 'none' };
}

/**
 * Load all generated tool definitions in a single pass: list the directory
 * once, read each file once, and return both the summary index (for the
 * system prompt) and the full approved definitions (for tool stub registration).
 *
 * Previously these were two separate functions that each listed + read the
 * same files, doubling the DA Admin calls.
 */
export async function loadGeneratedTools(
  client: DAAdminClient,
  org: string,
  site: string,
): Promise<{ index: GeneratedToolsIndex; approved: GeneratedToolDef[] }> {
  const { items, source } = await listToolFiles(client, org, site);
  if (items.length === 0) {
    return { index: { tools: [], source: 'none' }, approved: [] };
  }

  const repo = source === 'site' ? site : org;

  const defs = await Promise.all(
    items.map(async (item) => {
      const filename = item.name.endsWith('.json') ? item.name : `${item.name}.json`;
      const subPath = `generated-tools/${filename}`;
      try {
        const raw = await client.getSource(org, repo, subPath);
        const body = typeof raw === 'string' ? raw : ((raw as { content?: string })?.content ?? '');
        return JSON.parse(body) as GeneratedToolDef;
      } catch {
        return null;
      }
    }),
  );

  const valid = defs.filter(Boolean) as GeneratedToolDef[];

  const index: GeneratedToolsIndex = {
    tools: valid.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      status: def.status,
      capability: def.capability,
    })),
    source,
  };

  const approved = valid.filter((def) => def.status === 'approved');

  return { index, approved };
}

/**
 * Build the "Available Generated Tools" section for the agent system prompt.
 * Lists only approved tools so the model knows it can invoke them by id.
 */
export function buildGeneratedToolsPromptSection(index: GeneratedToolsIndex): string {
  const approved = index.tools.filter((t) => t.status === 'approved');
  if (approved.length === 0) return '';

  const lines = approved.map(
    (t) => `- **gen__${t.id}** (capability: ${t.capability}): ${t.description}`,
  );

  return `\n\n## Available Generated Tools
The following user-approved generated tools are available. Call them using their \`gen__<id>\` name.
${lines.join('\n')}

Generated tools run in an isolated sandbox with restricted DA API access:
- \`read-only\`: list and read DA content only
- \`read-write\`: may also create/update DA content (requires explicit user approval per call)`;
}
