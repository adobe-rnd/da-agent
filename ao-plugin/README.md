# DA Content Plugin for AO

AO plugin packaging DA's tools, skills, and A2A agent card for the Agent Orchestrator.

## Contents

| Directory | Contents |
|-----------|----------|
| `skills/skills-engineer/` | Built-in "Skills Engineer" preset (ported from da-agent) |
| `skills/da-content/` | Delegation skill: when/how to use DA tools and A2A |
| `.mcp.json` | EDS publishing MCP server declaration |
| `a2a/` | A2A agent card for content delegation |
| `.claude-plugin/` | AO marketplace metadata |

## Distribution

### Local development (current)

Registered via `plugins.sources` in the AO manifest:

```yaml
plugins:
  sources:
    - name: da-content
      source: /path/to/da-agent/ao-plugin
```

The `da-local.yaml` manifest already has this configured.

### Deployed (future — team decision needed)

Two options:

**Option A — Marketplace repo (recommended for shared plugins)**

Create a GitHub repository (e.g. `Adobe-Experience-Platform/da-ao-plugin`) with this
directory as the root. Register as a known marketplace in the AO manifest:

```yaml
known_marketplaces:
  - name: da-extensions
    source:
      repo: Adobe-Experience-Platform/da-ao-plugin

plugins:
  - ref: da-content@da-extensions
    version: "1.0.0"
```

**Option B — Plugin upload (recommended for single-team plugins)**

Upload directly via AO's plugin API:

```bash
ao plugin upload ./ao-plugin --manifest da-local
```

Or via REST:

```
POST /api/v1/manifests/{manifest_id}/plugins/upload
Content-Type: multipart/form-data
```

### MCP server URLs

The `.mcp.json` declares the EDS MCP server. Update the `source` URLs for your environment:

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:4002/mcp/eds` |
| Stage | `https://da-agent-ci.adobe.workers.dev/mcp/eds` |
| Production | `https://da-agent.adobe.workers.dev/mcp/eds` |

## Prerequisites

- da-agent running (provides the `/mcp/eds` and `/a2a/rpc` endpoints)
- AO instance with the `da-local.yaml` manifest (or equivalent)
