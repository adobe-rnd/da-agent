# DA MCP Stdio Bridge

Wraps stdio-based MCP servers in an HTTP interface so that da-agent (running in a Cloudflare Worker) can reach them via the standard Streamable HTTP transport.

## How it works

1. The bridge spawns MCP server processes as configured in `bridge-config.json`
2. Each server communicates via stdin/stdout (the MCP stdio transport)
3. The bridge exposes each server at `POST /mcp/<serverId>`
4. da-agent connects to these endpoints as if they were native HTTP MCP servers

## Setup

```bash
# Edit bridge-config.json with your server configurations
cp bridge-config.json my-config.json
# Edit my-config.json...

# Start the bridge
node server.js --config my-config.json
```

## Configuration

```json
{
  "port": 3100,
  "servers": {
    "my-server": {
      "command": "node",
      "args": ["./server.js"],
      "cwd": "/path/to/server",
      "env": { "KEY": "value" }
    }
  }
}
```

## Connecting from DA

In your repository's `mcp-servers/<id>/mcp.json`, set the `bridgeUrl`:

```json
{
  "command": "node",
  "args": ["./server.js"],
  "bridgeUrl": "https://your-bridge.example.com/mcp/my-server"
}
```

The `command`/`args` fields document the stdio configuration. The `bridgeUrl` tells da-agent where to send JSON-RPC requests.

## Endpoints

- `GET /health` -- bridge status and running servers
- `POST /mcp/<serverId>` -- forward JSON-RPC to the named MCP server
