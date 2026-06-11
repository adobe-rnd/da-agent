# DA Admin HTTP Surface — Investigation Results

## Finding: da-admin HAS a public HTTP API with IMS auth

da-admin is a Cloudflare Worker (`src/index.js`) that exposes a standard HTTP API. It validates IMS Bearer tokens via JWKS and applies ACL-based permissions. This means the "service binding blocker" identified in the AO plugin spec is **not a hard blocker** for MCP extraction.

## How auth works

1. Request arrives with `Authorization: Bearer <IMS JWT>` header
2. `getUsers()` in `src/utils/auth.js` validates the JWT via `jose` library (`jwtVerify` + IMS JWKS endpoint)
3. User profile and org membership are resolved from IMS profile/organizations APIs
4. Results are cached in `DA_AUTH` KV store for performance
5. ACL permissions are checked per-path via `getAclCtx()` and `hasPermission()`

## HTTP endpoints

da-admin routes by HTTP method on the request path:

| Method | Handler | Purpose |
|--------|---------|---------|
| GET | `src/handlers/get.js` | Read content, list sources, get config, get versions |
| POST | `src/handlers/post.js` | Create/update content, upload media |
| DELETE | `src/handlers/delete.js` | Delete content |
| HEAD | `src/handlers/head.js` | Check existence |

The path format is `/{org}/{repo}/{key}` where key is the content path within the repo.

Special API routes are determined by `daCtx.api` which is parsed from the request:
- `source` — content CRUD
- `list` — directory listing
- `config` — site configuration
- `version` — version management
- `copy` — copy content
- `move` — move content
- `properties` — metadata

## Deployed URLs

| Environment | URL |
|-------------|-----|
| Production | `https://admin.da.live` |
| Local | `http://localhost:8787` (via wrangler) |

The `DA_ORIGIN` env var in da-agent already references these URLs.

## Implications for MCP extraction

Since da-admin accepts IMS Bearer tokens over HTTP:

1. **An MCP server running outside the CF trust boundary CAN call da-admin directly** — no service binding required
2. The MCP server just needs the user's IMS token (which AO passes via `ims-passthrough` auth provider)
3. The `DAAdminClient` in da-agent uses service bindings for **performance** (in-process calls), not because external access is impossible

## What this unblocks

- **Phase 3 of the AO plugin spec** (DA content MCP server) can proceed without waiting for a "new" HTTP surface
- The MCP server would call `https://admin.da.live/{org}/{repo}/{path}` with the IMS token
- For local dev, it would call `http://localhost:8787/{org}/{repo}/{path}`

## Remaining considerations

- **Performance**: Service binding calls are in-process; HTTP calls add a network hop. For production, both da-agent and da-admin run on the same Cloudflare edge, so latency should be minimal.
- **CORS**: da-admin already sets CORS headers (via `daResp`), so cross-origin MCP calls work.
- **Rate limiting**: No evidence of rate limiting on da-admin — but this should be verified for high-volume MCP usage.
