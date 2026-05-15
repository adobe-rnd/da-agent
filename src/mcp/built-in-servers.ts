import type { BuiltInMCPServerConfig } from './types.js';

const GOVERNANCE_AGENT_INSTRUCTIONS = `\
Always use the **Live Preview URL** when interacting with the governance-agent — for both page evaluations and guideline retrieval. \
It always reflects the current document state without any preview/publish step needed.
"My/the brand guidelines" means guidelines for the current site, not the whole organization, unless the user says otherwise.`;

export function getBuiltInMcpServers(env: Env): Record<string, BuiltInMCPServerConfig> {
  const governanceUrl = env.GOVERNANCE_AGENT_URL;
  if (!governanceUrl) return {};

  return {
    'governance-agent': {
      type: 'http',
      url: governanceUrl,
      sendImsToken: true,
      instructions: GOVERNANCE_AGENT_INSTRUCTIONS,
    },
  };
}
