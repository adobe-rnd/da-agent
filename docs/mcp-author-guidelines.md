# MCP Server Author Guidelines for Experience Workspace

This document describes what a third‑party **MCP (Model Context Protocol) server**
must do to work seamlessly inside Experience Workspace once it has been registered.

Experience Workspace connects to your server through the `da-agent` MCP client, which
runs **inside a Cloudflare Worker** (fetch‑based, no Node.js runtime). That environment
dictates most of the constraints below.

> Source of truth: `da-agent/src/mcp/client.ts`, `da-agent/src/mcp/tool-adapter.ts`,
> `da-agent/src/tool-assembly.ts`, `da-agent/src/mcp/token-allowlist.ts`.
> If the code and this doc disagree, the code wins — please open a PR to update this doc.

---

## 1. Transport: Streamable HTTP (required)

The client speaks the **Streamable HTTP** transport (MCP protocol revision
`2025-03-26`). A legacy **SSE** (`text/event-stream`) response is accepted as a
backwards‑compatible fallback, but plain Streamable HTTP is the recommended target.

- **`stdio` is NOT supported.** There is no process to spawn in a Cloudflare Worker.
- Your server is registered as `type: 'http'` (Streamable HTTP) or `type: 'sse'`.

### What the client sends

Every JSON‑RPC call is a single `POST` to your server URL with:

```http
POST <your-server-url>
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Session-Id: <id>        # only after you return one (see below)
```

Your server may respond with **either**:

- `Content-Type: application/json` — a single JSON‑RPC response, **or**
- `Content-Type: text/event-stream` — SSE; the client reads the stream and uses the
  first valid JSON‑RPC response (`{ "jsonrpc": "2.0", "result"|"error": ... }`) it finds.

Either content type is fine. Pick whichever your framework produces.

### Session handling

- If you return an `Mcp-Session-Id` response header on `initialize`, the client captures
  it and echoes it back on every subsequent request. Sessions are optional — if you don't
  return one, the client just won't send one.
- On shutdown the client sends `DELETE <url>` with the `Mcp-Session-Id` header
  (best‑effort; failures are ignored). Don't depend on receiving it.

### Required handshake

The client always performs this sequence. Implement all of it:

1. `initialize` →
   ```json
   { "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "da-agent", "version": "1.0.0" } }
   ```
   Respond with your `result` (capabilities, serverInfo, etc.).
2. `notifications/initialized` — a **notification** (no `id`). Return HTTP **202** with no
   body. The client does not expect a JSON‑RPC response here.
3. `tools/list` — return `{ "tools": [ ... ] }`.
4. `tools/call` — `{ "name": "...", "arguments": { ... } }` → return a tool result
   (see §5).

If `initialize` or `tools/list` throws/times out, your server is **silently dropped** for
that request and none of your tools appear. Make these two calls fast and reliable.

---

## 2. Timeouts

The client uses an `AbortController` per request and aborts on timeout, surfacing
`MCP request timed out after <n>ms`.

| Path | Effective timeout | Notes |
| --- | --- | --- |
| Tool discovery + tool calls during a chat (`connectAndRegisterMCPTools`) | **15,000 ms** | Applied in `tool-assembly.ts`. Covers `initialize`, `tools/list`, **and** each `tools/call`. |
| `MCPClient` standalone default | 30,000 ms | Library default; the assembly path overrides it to 15s. |

**Practical budget: every `initialize`, `tools/list`, and `tools/call` must complete
within ~15 seconds.** This is wall‑clock, including your upstream/backend latency.

Guidance:

- Keep `initialize` and `tools/list` well under a second — they run on every chat turn and
  all servers connect in parallel (`Promise.all`), so one slow server delays nothing else,
  but a slow server that exceeds 15s contributes **zero** tools.
- For genuinely long work, return quickly with a job handle / status tool the model can
  poll, rather than blocking a single `tools/call` past the timeout.
- There is no client‑side retry. A timed‑out or failed call returns an error to the model
  for that turn.

---

## 3. Domain allow list & token forwarding

Experience Workspace forwards the signed‑in user's **IMS bearer token** (and the DA OAuth
client id as `x-api-key`) to your server **only if your URL's hostname matches the trusted
domain allow list.** Untrusted servers receive only the explicit headers the caller
configured — never the user's token.

- Allow list comes from env `TRUSTED_MCP_DOMAINS` (comma‑separated). **Default:
  `*.adobe.io`.**
- Pattern matching (`isUrlTrustedForToken`):
  - `*.example.com` matches `example.com` **and** any subdomain (`foo.example.com`).
  - `example.com` matches that exact hostname only.
  - Hostnames are compared lowercase; an unparseable URL is treated as untrusted.

**Implications for authors:**

- If your server needs the user's Adobe identity (IMS token / `x-api-key`), it must be
  hosted on a **trusted domain** (by default, under `*.adobe.io`). Otherwise add your
  domain to `TRUSTED_MCP_DOMAINS` via the deployment owner.
- When trusted, expect:
  ```http
  Authorization: Bearer <user-IMS-token>
  x-api-key: <DA OAuth client id>
  ```
  Validate the token yourself; do not assume presence implies authorization.
- If you are **not** on a trusted domain, do not rely on receiving any Adobe credential.
  Use your own auth via custom headers (see §4).

---

## 4. Authentication & custom headers

Two ways your server can be authenticated:

1. **Adobe IMS passthrough** — automatic, trusted‑domain only (§3).
2. **Caller‑supplied headers** — the chat request may include `mcpServerHeaders` keyed by
   server id. These are merged into every request to your URL. Use this for your own API
   keys / bearer tokens when you are not on a trusted domain.

```jsonc
{
  "mcpServers":       { "my-server": "https://mcp.example.com/mcp" },
  "mcpServerHeaders": { "my-server": [{ "name": "X-My-Api-Key", "value": "..." }] }
  // a { "Header-Name": "value" } object form is also accepted
}
```

Requirements & cautions:

- **HTTPS only.** Plain `http://` is disallowed in production (Node security rules) and
  the platform requires TLS for all external communication.
- **No secrets in tool parameters or in the URL.** Per the MCP security rules, credentials
  and PII must not travel as tool arguments — use headers and your own server‑side auth.
- Header values are sent verbatim on **every** request to your URL; scope them tightly.

---

## 5. Tool definitions & results

### Tool naming

The client namespaces every discovered tool as:

```
mcp__<serverId>__<yourToolName>
```

Keep your own tool `name`s short, stable, and `snake_case`/`kebab` friendly. Renaming a
tool breaks any saved references and the model's learned usage.

### Input schemas

Your `inputSchema` (JSON Schema) is converted to Zod before being handed to the model
provider (Bedrock via AI SDK v6). The converter (`mcpSchemaToZod`) is intentionally
conservative:

- Recognized scalar types map cleanly: `number`/`integer` → number, `boolean` → boolean,
  `string` → string.
- `array` becomes `array(any)` and `object` becomes a free‑form record — **item and nested
  property types are not deeply validated.**
- `required` is honored at the top level; everything else is optional.
- Malformed property entries degrade to `any().optional()` instead of failing.

To be maximally robust:

- Keep input schemas **flat and scalar where possible.** Top‑level primitive params with
  clear `description`s work best.
- Provide a `description` on the tool and on each property — the model relies on these.
- Avoid exotic JSON Schema (oneOf/allOf/`$ref`/tuple typing); it will be flattened to
  `any` and lose guard rails.

### Tool results

Return the standard MCP tool result shape:

```json
{ "content": [ { "type": "text", "text": "..." } ], "isError": false }
```

- A single `text` part is unwrapped to a plain string for the model; multiple parts are
  passed through as the content array.
- On failure set `isError: true`; the client concatenates the text parts into an `error`
  string. Exceptions and timeouts are also surfaced to the model as `{ error: ... }`.
- Return concise, model‑readable text. Large blobs cost tokens on every turn.

---

## 6. Registration shape (what Experience Workspace stores)

A registered remote server resolves to:

```ts
// da-agent/src/mcp/types.ts
interface RemoteMCPServerConfig {
  type: 'http' | 'sse';          // 'http' = Streamable HTTP (recommended)
  url: string;                   // your HTTPS endpoint
  headers?: Record<string, string>;
}
```

- Per chat request, servers arrive as a `{ id: url }` map (`mcpServers`) plus optional
  per‑id `mcpServerHeaders`.
- Servers that connect but register **zero** tools are pruned from the system prompt, so
  the model is never told about an unusable server. Make sure `tools/list` returns your
  tools on a cold call.

---

## 7. Pre‑registration checklist

- [ ] Endpoint is reachable over **HTTPS**.
- [ ] Implements **Streamable HTTP** (JSON or SSE response); handles a single `POST` per
      JSON‑RPC message.
- [ ] `initialize` accepts `protocolVersion: "2025-03-26"` and returns promptly.
- [ ] `notifications/initialized` returns **202** with no body.
- [ ] `tools/list` returns within ~15 s on a cold session.
- [ ] Every `tools/call` returns within ~15 s, or is redesigned to be async/pollable.
- [ ] `Mcp-Session-Id` (if used) is honored on follow‑up requests and `DELETE`.
- [ ] Tool input schemas are flat/scalar with descriptions.
- [ ] Tool results use the `{ content: [{ type, text }], isError }` shape.
- [ ] If you need the user's Adobe identity: hosted on a **trusted domain**
      (`*.adobe.io` by default) or added to `TRUSTED_MCP_DOMAINS`.
- [ ] No secrets/PII accepted via tool **arguments** or URL — credentials go in headers.
- [ ] Server validates the bearer token / API key it receives; fails closed on error.
