# AO Integration

da-agent integrates with Adobe's Agent Orchestrator (AO) on three surfaces:

1. **DA consumes AO marketplace** — fetches plugin skills and MCP server configs from a running AO instance
2. **DA exposes itself as an A2A agent** — AO can discover and delegate content authoring tasks to da-agent
3. **AO harness mode** — da-agent can proxy chat requests to AO's A2A endpoint, acting as a thin protocol adapter between the DA UI and AO

All surfaces are optional and controlled by environment variables.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `AO_BACKEND_URL` | Base URL of a running AO backend (e.g. `http://localhost:8080`). Empty to disable. | `""` (disabled) |

Set in `wrangler.toml` under `[env.dev.vars]` for local development, or as a Cloudflare secret for deployed environments.

## Phase 1: Marketplace consumption

When `AO_BACKEND_URL` is set, da-agent calls AO's REST APIs during the chat pipeline to discover and merge additional skills and MCP servers.

### Flow

```
handleChat
  └─ resolveAOContext(env.AO_BACKEND_URL, imsToken)
       ├─ GET /api/v1/plugins          → list installed plugins + discovered skills
       ├─ GET /api/v1/manifests/…/mcp-servers → collect MCP server configs
       └─ returns AOContext { client, plugins, skills, mcpServers }

  └─ resolveSkillsAndAgent(ctx, body, aoCtx)
       └─ merges ao: prefixed skills into the DA skills index

  └─ assembleTools(ctx, env, body, aoCtx)
       └─ merges ao: prefixed MCP servers into allMcpServers
```

### Namespacing

All AO-sourced artifacts are prefixed to avoid collision with native DA content:

- Skills: `ao:{pluginName}/{skillName}` (e.g. `ao:dx-api/dx-api`)
- MCP servers: `ao:{serverName}` (e.g. `ao:firefall-mcp`)

### Modules

| Module | Purpose |
|---|---|
| `src/ao/marketplace-client.ts` | HTTP client for AO REST APIs |
| `src/ao/skill-adapter.ts` | Converts AO `SKILL.md` → DA `SkillSummary`, resolves skill bodies |
| `src/ao/mcp-adapter.ts` | Converts AO plugin MCP configs → DA `RemoteMCPServerConfig` |
| `src/ao/integration.ts` | Facade: bootstraps the full AO context in one call |

### AO REST endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/plugins` | GET | List installed plugins with discovered skills |
| `/api/v1/plugins/{name}/skills` | GET | Preview skill content for a specific plugin |
| `/api/v1/manifests/{id}/mcp-servers` | GET | Get MCP server configs from manifest |
| `/health` | GET | Health check (used for connectivity verification) |

### Skill format adaptation

AO skills have richer frontmatter than DA skills (`apis`, `databases`, `hooks`, `metadata.dependencies`). The adapter strips AO-specific frontmatter before yielding the skill body to the model, keeping only the instructional markdown content.

## Phase 2: A2A agent exposure

da-agent publishes itself as an A2A-compatible agent that AO (or any A2A orchestrator) can discover and delegate tasks to.

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/.well-known/agent.json` | GET | A2A agent card (discovery) |
| `/a2a/.well-known/agent.json` | GET | A2A agent card (AO convention path) |
| `/a2a/rpc` | POST | A2A JSON-RPC endpoint |

### Agent card

Returns a JSON document describing da-agent's capabilities:

```json
{
  "name": "DA Content Agent",
  "url": "https://<host>/a2a/rpc",
  "capabilities": { "streaming": true, "pushNotifications": false },
  "skills": [
    { "id": "content-management", "name": "Content Management", ... },
    { "id": "eds-publishing", "name": "Edge Delivery Services Publishing", ... },
    { "id": "live-editing", "name": "Live Collaborative Editing", ... }
  ]
}
```

### JSON-RPC methods

| Method | Supported | Description |
|---|---|---|
| `tasks/send` | Yes | Synchronous task execution — forwards to `/chat` pipeline |
| `tasks/sendSubscribe` | Yes | Streaming variant (currently falls back to synchronous) |
| `tasks/get` | No | Stateless agent — no task persistence |
| `tasks/cancel` | No | Not implemented |

### Message format

The RPC handler converts between A2A and Vercel AI SDK message formats:

- **Inbound**: A2A `{ role, parts: [{ type: "text", text }] }` → AI SDK `{ role: "user", content: text }`
- **Outbound**: AI SDK stream text parts → A2A `{ artifacts: [{ parts: [{ type: "text", text }] }] }`

### Modules

| Module | Purpose |
|---|---|
| `src/a2a/agent-card.ts` | Builds and serves the A2A agent card |
| `src/a2a/rpc-handler.ts` | JSON-RPC handler with message format adapter |

## EDS MCP server endpoint

da-agent exposes its EDS tools as an MCP server at `POST /mcp/eds`, using MCP's streamable HTTP transport (JSON-RPC over HTTP).

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/mcp/eds` | POST | Bearer IMS token | EDS preview/publish tools via MCP protocol |

Supports MCP methods: `initialize`, `tools/list`, `tools/call`, `ping`.

Available tools: `content_preview`, `content_publish`, `content_unpreview`, `content_unpublish`.

### Modules

| Module | Purpose |
|---|---|
| `src/mcp-server/handler.ts` | Lightweight MCP JSON-RPC handler (no SDK) |
| `src/mcp-server/eds-registry.ts` | EDS tool definitions + execution |

## AO Plugin package

The `ao-plugin/` directory contains a ready-to-publish AO plugin:

```
ao-plugin/
  .claude-plugin/
    marketplace.json       # AO marketplace metadata
  .mcp.json                # EDS MCP server declaration (da-publish)
  skills/
    skills-engineer/
      SKILL.md             # Built-in "Skills Engineer" preset
    da-content/
      SKILL.md             # Delegation skill: when/how to use DA tools
  a2a/
    da-content-agent.yaml  # A2A agent card for content delegation
```

### Registration

The `da-local.yaml` AO manifest registers this plugin via `plugins.sources`:

```yaml
plugins:
  sources:
    - name: da-content
      source: /path/to/da-agent/ao-plugin
```

AO's plugin discovery automatically walks the directory and registers skills, MCP servers, and A2A cards.

For deployed environments, see `ao-plugin/README.md` for marketplace repo and upload options.

## Phase 3: AO harness mode (protocol adapter)

When the client sends `{ harness: "ao" }` in the chat POST body and `AO_BACKEND_URL` is set, da-agent skips its own Bedrock pipeline entirely and proxies the request to AO's A2A `message/stream` endpoint, translating the response back to Vercel AI SDK format.

### Flow

```
da-nx POST /chat { harness: "ao", messages, imsToken }
  └─ da-agent handleChat
       └─ harness === "ao" && AO_BACKEND_URL?
            ├─ YES → handleAOProxiedChat()
            │         ├─ extract latest user message
            │         ├─ POST /a2a/rpc { method: "message/stream" } → AO
            │         └─ translate AO SSE → Vercel AI SDK SSE → client
            └─ NO  → normal Bedrock pipeline
```

### Protocol translation

| AO event | Vercel AI SDK event |
|---|---|
| `artifact-update` (text part) | `text-delta` |
| `task` (completed, with artifacts) | `text-delta` + `text-end` + `finish-message` |
| `status-update` | Ignored (AO thinking indicator) |

### UI toggle

The Skills Editor (ew-extensions) provides a DA/AO toggle switch in the top navigation bar:

- Persisted in `localStorage` as `da-harness` (`"da-agent"` or `"ao"`)
- Read by da-nx `chat-controller.js` and included in every chat POST body
- da-agent uses this to choose between Bedrock and AO harness code paths

### Modules

| Module | Purpose |
|---|---|
| `src/ao/chat-adapter.ts` | Translates between Vercel AI SDK and A2A SSE formats |

## Local development

1. Start AO on a custom port (to avoid conflict with DA live proxy on 3000):

```bash
AO_WEB_PORTS=3185 ao -m .ao/manifests/aep-aia/da-local.yaml
```

2. Set `AO_BACKEND_URL` in `wrangler.toml` to the AO backend port (printed in AO startup logs):

```toml
[env.dev.vars]
AO_BACKEND_URL = "http://localhost:64053"
```

3. Start da-agent normally:

```bash
npm run dev
```

4. To test the AO harness mode, flip the DA/AO toggle in the Skills Editor (or set `localStorage.setItem('da-harness', 'ao')` in the browser console).

The agent logs AO integration status on each chat request:

```
[da-agent:ao] resolved 5 plugins, 12 skills, 3 MCP servers
```

If AO is unreachable, the integration silently degrades — native DA functionality is unaffected.
