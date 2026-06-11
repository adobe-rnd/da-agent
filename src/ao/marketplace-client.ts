/**
 * AO (Agent Orchestrator) marketplace HTTP client.
 *
 * Fetches installed plugins, skill content, and MCP server configs
 * from a running AO backend instance via its REST API.
 *
 * Feature-gated: only active when `env.AO_BACKEND_URL` is set.
 */

export interface AOPluginSkill {
  name: string;
  description: string;
  skill_path: string;
}

export interface AOPluginRecord {
  name: string;
  marketplace_name: string;
  version: string;
  description: string;
  status: string;
  discovered_skills: AOPluginSkill[];
}

export interface AOMCPServer {
  name: string;
  source: string;
  transport: 'streamable_http' | 'sse' | 'stdio';
  auth?: string;
}

export interface AOSkillPreview {
  name: string;
  description: string;
  skill_path: string;
}

export class AOMarketplaceClient {
  private baseUrl: string;

  private timeout: number;

  private imsToken?: string;

  constructor(baseUrl: string, imsToken?: string, timeout = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = timeout;
    this.imsToken = imsToken;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.imsToken) {
        headers.Authorization = `Bearer ${this.imsToken}`;
      }
      const resp = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers,
      });

      if (!resp.ok) {
        throw new Error(`AO API ${path}: HTTP ${resp.status}`);
      }

      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async listPlugins(): Promise<AOPluginRecord[]> {
    return this.request<AOPluginRecord[]>('/api/v1/plugins');
  }

  async previewPluginSkills(pluginName: string): Promise<AOSkillPreview[]> {
    return this.request<AOSkillPreview[]>(
      `/api/v1/plugins/${encodeURIComponent(pluginName)}/skills`,
    );
  }

  async getMCPServers(manifestId = 'da-local'): Promise<AOMCPServer[]> {
    const data = await this.request<{ servers: AOMCPServer[] }>(
      `/api/v1/manifests/${encodeURIComponent(manifestId)}/mcp-servers`,
    );
    return data.servers ?? [];
  }

  async readSkillFile(skillName: string, path = 'SKILL.md'): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const headers: Record<string, string> = { Accept: 'text/plain' };
        if (this.imsToken) headers.Authorization = `Bearer ${this.imsToken}`;
        const resp = await fetch(
          `${this.baseUrl}/api/v1/skills/${encodeURIComponent(skillName)}/files?path=${encodeURIComponent(path)}`,
          { signal: controller.signal, headers },
        );
        if (!resp.ok) return null;
        return await resp.text();
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<unknown>('/health');
      return true;
    } catch {
      return false;
    }
  }
}
