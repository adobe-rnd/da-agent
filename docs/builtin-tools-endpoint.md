# Built-in Tools Endpoint

Clients that build tool discovery UIs (e.g. slash menus) currently hardcode built-in tool names
and descriptions. That list drifts — the client may reference `da_list_sources` while the
registered tool is `content_list`. This endpoint fixes that by letting clients fetch the
authoritative list at runtime.

---

## Endpoint

```
GET /tools
```

No authentication required. No request body. Returns built-in tool metadata in the same shape
as the `/mcp-tools` response so clients can handle both sources with the same code path.

**Response:**
```json
{
  "servers": [
    {
      "id": "da-builtin",
      "tools": [
        { "name": "<tool-name>", "description": "<tool-description>" }
      ]
    }
  ]
}
```

---

## Implementation

### 1. Export metadata from `src/tools/tools.ts`

Add a static `BUILTIN_TOOL_METADATA` array alongside the existing tool definitions.
Descriptions should stay in sync with those in the `tool()` calls.

```ts
export const BUILTIN_TOOL_METADATA: Array<{ name: string; description: string }> = [
  { name: 'content_list', description: '...' }, // reuse the existing description string from tool()
  // ... all tools from createDATools, createEDSTools, createCanvasClientTools
];
```

### 2. Add route to `src/server.ts`

Import `BUILTIN_TOOL_METADATA` and add a `GET /tools` handler alongside the existing
`/chat` and `/mcp-tools` routes (around `src/server.ts:170`):

```ts
if (url.pathname === '/tools' && request.method === 'GET') {
  return new Response(
    JSON.stringify({ servers: [{ id: 'da-builtin', tools: BUILTIN_TOOL_METADATA }] }),
    { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  );
}
```

No authentication, no client instantiation — the response is a static JSON payload.

---

## Client impact

Once live, clients call `GET /tools` and merge the result with any `/mcp-tools` response.
The `da-builtin` server entry renders alongside configured MCP servers with no additional
client-side logic. The hardcoded `BUILTIN_TOOLS` array on the client can then be removed.
