# Registering an MCP Server in Experience Workspace

This guide is for **content administrators and team leads** who need to connect a third‑party
MCP (Model Context Protocol) server to Experience Workspace. No coding required.

---

## What registration means

When you register an MCP server, Experience Workspace connects to it at the start of each
chat session to discover what tools it provides. Those tools then become available to the
AI assistant for the duration of that conversation.

All you need to register a server is:

- A **name** you choose (used to identify the server in your configuration)
- The server's **URL** (provided by the team or vendor who built the server)
- Optionally, one or more **authentication headers** (the server team will tell you if
  these are needed and what values to use)

---

## Do you need to supply credentials?

### If the server is on an Adobe domain (`*.adobe.io`)

Nothing extra required. Experience Workspace automatically forwards the signed‑in user's
Adobe identity to any server hosted under `*.adobe.io`. The server will recognise the user
without any additional configuration on your side.

**Examples of Adobe‑domain URLs:**

```
https://governance-agent.adobe.io/mcp
https://my-tool.adobeioruntime.net/api/v1/web/mcp
```

> If you are unsure whether a URL qualifies, check with the team who built the server.
> If the URL ends in `.adobe.io` or a subdomain of it, you are covered.

---

### If the server is on a non‑Adobe domain

The user's Adobe identity is **not** forwarded automatically. The server team will need to
give you a credential (usually an API key or a service token) that you supply as an HTTP
header at registration time.

**What to ask the server team:**

1. What is the **header name** I need to send? (e.g. `X-Api-Key`, `Authorization`)
2. What is the **header value** I need to send? (e.g. a specific API key string)
3. Does the key expire, and if so, how do I rotate it?

Keep credentials they provide confidential — treat them like a password.

---

## How to register: step by step

### 1. Gather the details

Before you start, have ready:

| Field | Where to get it |
| --- | --- |
| Server name | Choose any short, unique label (e.g. `style-checker`) |
| Server URL | Provided by the server team — must start with `https://` |
| Header name + value | Provided by the server team, if needed |

### 2. Add the server

In your chat configuration, add the server under `mcpServers` using the name you chose
and the URL you were given:

```json
{
  "mcpServers": {
    "style-checker": "https://mcp.example.com/mcp"
  }
}
```

### 3. Add credentials (non‑Adobe domains only)

If the server team gave you a header, add it under `mcpServerHeaders` using the same
name you chose in step 2:

```json
{
  "mcpServers": {
    "style-checker": "https://mcp.example.com/mcp"
  },
  "mcpServerHeaders": {
    "style-checker": [
      { "name": "X-Api-Key", "value": "the-key-the-team-gave-you" }
    ]
  }
}
```

If the server team gave you more than one header, add each as a separate entry in the
list:

```json
"style-checker": [
  { "name": "X-Api-Key",   "value": "abc123" },
  { "name": "X-Client-Id", "value": "my-org" }
]
```

### 4. Verify

After saving, start a new chat session. If the server connected successfully, its tools
will be available to the assistant. If something went wrong (wrong URL, missing or
incorrect credential), the server is silently skipped and its tools will not appear — go
back and double‑check the URL and header values with the server team.

---

## Security reminders

- **Keep credentials private.** Anyone who has the header value can call the server on
  your behalf.
- **Only register servers from teams you trust.** The AI assistant will be able to call
  any tool the server exposes on behalf of your users.
- **Never put credentials in the URL itself** (e.g. `?api_key=...`). Always use the
  `mcpServerHeaders` field.
- Servers must use `https://`. A plain `http://` address will not be accepted.

---

## Need the server added to the Adobe trusted domain list?

If the server your team built lives on a non‑Adobe domain but you want it to receive the
user's Adobe identity automatically (without managing a separate API key), the server URL
needs to be added to the platform's trusted domain allow list. This is a deployment‑level
change — raise a request with your platform or infrastructure owner and provide them with
the server's hostname.
