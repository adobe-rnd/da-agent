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

const DA_SC_INSTRUCTIONS = `\
DA Structured Content (schema-driven forms) tools live on this server (\`sc_compile_schema\`, \`sc_validate_document\`, \`sc_serialize_schema\`, \`sc_serialize_document\`). \
Schemas are stored at \`/.da/forms/schemas/{schemaName}.html\` via the regular content tools (content_create/content_read).
Editor URLs: schema editor is \`https://da.live/apps/schema#/<org>/<site>\` (lists all schemas — mention the schema name in prose, it is not part of the URL); \
document editor for a structured content document is \`https://da.live/form#/<org>/<site>/<path-without-.html>\` (note the \`/form\` route, not \`/edit\`).
For detailed workflows (schema design, document import, validation, serialization), read the matching skill via \`da_read_skill\` before acting: \
\`generate-schema\`, \`import-structured-content\`, \`serialize-structured-content\`, \`validate-structured-content\`, \`compute-editor-urls\`, \`author-structured-content\`.
`;

export function getBuiltInMcpServers(env: Env): Record<string, BuiltInMCPServerConfig> {
  const servers: Record<string, BuiltInMCPServerConfig> = {};

  const governanceUrl = env.GOVERNANCE_AGENT_URL;
  if (governanceUrl) {
    servers['governance-agent'] = {
      type: 'http',
      url: governanceUrl,
      sendImsToken: true,
      instructions: GOVERNANCE_AGENT_INSTRUCTIONS,
    };
  }

  const daScUrl = env.DA_SC_MCP_URL;
  if (daScUrl) {
    servers['da-sc'] = {
      type: 'http',
      url: daScUrl,
      instructions: DA_SC_INSTRUCTIONS,
    };
  }

  return servers;
}
