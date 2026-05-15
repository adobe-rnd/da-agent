# Chat API

`POST /chat` — streaming chat endpoint. Returns a [Vercel AI SDK UI message stream](https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol).

## Request

```json
{
  "messages": [...],
  "pageContext": { "org": "string", "site": "string", "path": "string", "view": "string?" },
  "imsToken": "string?",
  "agentId": "string?",
  "requestedSkills": ["skill-id", "..."],
  "mcpServers": { "<id>": "<url>", "..." },
  "mcpServerHeaders": { "<id>": [{ "name": "string", "value": "string" }] },
  "attachments": [...]
}
```

### `messages`

Conversation history. Standard AI SDK message objects plus two extension message types for the tool approval protocol — see [Tool approval protocol](#tool-approval-protocol).

User messages may carry extra fields (`selectionContext`, `attachmentsMeta`) — see their sections below.

### `pageContext`

Optional. Sets the default org, site, and path for all DA tool calls. `view` should be `edit` or `browse`.

### `requestedSkills`

Optional array of skill IDs to activate for this request. IDs must not include the `.md` extension.

Re-send on every continuation POST for the same user turn — skills must be present on each request that expects them to be active.

### `attachments`

Optional array of file attachments accompanying the latest user message.

```json
{
  "id": "uuid",
  "fileName": "image.png",
  "mediaType": "image/png",
  "dataBase64": "...",
  "contentUrl": "https://admin.da.live/...",
  "sizeBytes": 12345
}
```

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Stable reference ID. Used as `attachmentRef` when the model calls `content_upload`. |
| `fileName` | Yes | Original file name. |
| `mediaType` | Yes | MIME type. |
| `dataBase64` | One of | Raw file bytes, base64-encoded. Use when the file has not yet been uploaded. |
| `contentUrl` | One of | DA storage URL from a prior `content_upload` result. Use when the file is already in storage. |
| `sizeBytes` | No | File size in bytes. |

At least one of `dataBase64` or `contentUrl` must be present — the schema rejects attachments with neither.

**File type handling:** Behavior differs by type:

- **Markdown** (`.md` / `text/markdown`) with `dataBase64` — content is decoded and inlined directly into the model context. The agent reads the file without needing to upload it first. It may still call `content_upload` to persist the file in DA, but only if the task requires it.
- **All other types** with `dataBase64` — upload-only. The agent receives file metadata and can call `content_upload` to store the file in DA, but does not read binary content.
- **Any type** with `contentUrl` — the file is already in DA storage. The agent uses the URL directly and must not call `content_upload` again.

**Approval continuation pattern:** On the first POST, send `dataBase64`. If the agent pauses for approval after `content_upload` has run, re-send the attachment on the continuation POST with `contentUrl` (from the tool result) and omit `dataBase64`. If the approval pause happened before `content_upload` ran, re-send the original `dataBase64` unchanged.

## Response

`text/plain; charset=utf-8` — Vercel AI SDK UI message stream (newline-delimited JSON objects).

All events are standard AI SDK stream parts: text deltas, tool calls, tool results, and finish events.

## Tool approval protocol

Certain DA tools require explicit user confirmation before executing. The protocol:

1. Agent emits a `tool-call` stream event for the tool.
2. Agent emits a `tool-approval-request` stream event with an `approvalId` linking it to the tool call.
3. Stream pauses. The client presents the approval UI.
4. Client sends a new POST with the full conversation history plus one new `tool` role message appended:

```json
{
  "role": "tool",
  "content": [{
    "type": "tool-approval-response",
    "approvalId": "<approvalId from step 2>",
    "approved": true
  }]
}
```

The agent executes the tool (if approved) or returns a rejection result, then continues the stream.

## Selection context

User messages may include a `selectionContext` field — page excerpts attached by the user:

```json
{
  "role": "user",
  "content": "User message text",
  "selectionContext": [
    { "proseIndex": 2, "blockName": "hero", "innerText": "Welcome to DA" }
  ]
}
```

| Field | Description |
|---|---|
| `proseIndex` | Zero-based index in the collaborative editor document |
| `blockName` | CSS class name of the block, or filename for browse selections |
| `innerText` | Text content of the selection |

## MCP tools

`GET /mcp-tools` — discover tools from a set of MCP servers before passing them to `/chat`.

```json
{ "servers": { "<id>": "<url>", "..." } }
```

Returns:
```json
{
  "servers": [
    { "id": "string", "tools": [{ "name": "string", "description": "string" }] },
    { "id": "string", "tools": [], "error": "Connection failed: ..." }
  ]
}
```

Tools are available in `/chat` requests via the same `mcpServers` map. Tool names are prefixed `mcp__<serverId>__<toolName>`.
