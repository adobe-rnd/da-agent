import type { BuiltInMCPServerConfig } from './types.js';

const GOVERNANCE_AGENT_INSTRUCTIONS = `\
Always use the **Live Preview URL** when interacting with the governance-agent — for both page evaluations and guideline retrieval. \
It always reflects the current document state without any preview/publish step needed.
"My/the brand guidelines" means guidelines for the current site, not the whole organization, unless the user says otherwise.`;

const BUILT_IN_MCP_SERVERS: Record<string, Record<string, BuiltInMCPServerConfig>> = {
  production: {
    'governance-agent': {
      type: 'http',
      url: 'https://adobe-aem-foundation-brand-governance-agent-deploy-9950ff.cloud.adobe.io/mcp/',
      sendImsToken: true,
      instructions: GOVERNANCE_AGENT_INSTRUCTIONS,
    },
  },
  ci: {
    'governance-agent': {
      type: 'http',
      url: 'https://brand-governance-agent-stage.adobe.io/mcp/',
      sendImsToken: true,
      instructions: GOVERNANCE_AGENT_INSTRUCTIONS,
    },
  },
  dev: {
    'governance-agent': {
      type: 'http',
      url: 'https://brand-governance-agent-stage.adobe.io/mcp/',
      // url: 'http://127.0.0.1:8000/mcp/',
      sendImsToken: true,
      instructions: GOVERNANCE_AGENT_INSTRUCTIONS,
    },
  },
};

export function getBuiltInMcpServers(env: Env): Record<string, BuiltInMCPServerConfig> {
  return BUILT_IN_MCP_SERVERS[env.ENVIRONMENT ?? 'production'] ?? {};
}
