import type { BuiltInMCPServerConfig } from './types.js';

const GOVERNANCE_AGENT_INSTRUCTIONS = `\
Always use the **Live Preview URL** when interacting with the governance-agent — for both page evaluations and guideline retrieval. \
It always reflects the current document state without any preview/publish step needed.
"My/the brand guidelines" means guidelines for the current site, not the whole organization, unless the user says otherwise.

When the user asks about "brand guidelines," always retrieve brand context data/brand rules (design tokens, claim guardrails, brand voice, competitor positioning, segments, etc.) — not checks; checks are governance tests only and should only be retrieved when explicitly asked for.

Brand rules default to global; rules sharing the same vertical, category, and ID but targeting a narrower segment override broader ones in a cascade fashion — a more targeted segment wins when it covers more dimensions, fewer values per dimension, or has a higher priority.

When necessary, ensure you have the full picture before drawing conclusions about a brand's configuration.

"Enterprise Ground Truth" "Enterprise Context" and similar terms all refer to the Governance Agent MCP.
`;

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
