# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command               | Purpose                          |
| --------------------- | -------------------------------- |
| `npm run check`       | Format check, lint, and type check |
| `npx wrangler dev`    | Local development                |
| `npx wrangler deploy` | Deploy to Cloudflare             |
| `npx wrangler types`  | Generate TypeScript types        |

Run `wrangler types` after changing bindings in `wrangler.jsonc`, then manually add any service binding types to `env.d.ts` (e.g. `DAADMIN: Fetcher`).

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Project Structure

| Path | Purpose |
| ---- | ------- |
| `src/server.ts` | Worker entry point; `ChatAgent` Durable Object with `onChatMessage` |
| `src/tools/tools.ts` | `createDATools(client)` — Vercel AI SDK `tool()` definitions for all DA operations |
| `src/da-admin/client.ts` | `DAAdminClient` — wraps all DA Admin API calls via the `DAADMIN` service binding |
| `src/da-admin/types.ts` | TypeScript types for the DA Admin API |
| `src/app.ts` | Frontend chat UI |

## DA Tools

DA Admin tools are implemented locally via a Cloudflare **service binding** (`DAADMIN → da-admin`) instead of an external MCP server. This eliminates network latency and the dynamic MCP registration/removal per request.

- Tools are only registered when the user provides an IMS token (`imsToken` in request body).
- `createDATools(client)` returns a Vercel AI SDK tool map; spread it into `streamText({ tools })`.
- Each tool's `execute` wraps the client call with try/catch: `DAAPIError` → `{ error, status }`, other errors → `{ error: String(e) }`.
- Tool invocations are logged: `[tool] <name> <args>`.

After adding or changing the `DAADMIN` service binding in `wrangler.jsonc`, add `DAADMIN: Fetcher` to the `Cloudflare.Env` interface in `env.d.ts` manually (wrangler types does not emit service binding types).
