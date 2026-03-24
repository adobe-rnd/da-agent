#!/usr/bin/env node

/**
 * DA MCP Stdio Bridge
 *
 * Wraps stdio-based MCP servers in an HTTP interface so that
 * da-agent (running in a Cloudflare Worker) can connect to them
 * using the standard Streamable HTTP transport.
 *
 * Usage:
 *   node server.js --config bridge-config.json
 *
 * Config format:
 *   {
 *     "port": 3100,
 *     "servers": {
 *       "acme-tools": { "command": "node", "args": ["./dist/server.js"], "cwd": "/path/to/acme" },
 *       "data-tools": { "command": "python", "args": ["-m", "data_tools"] }
 *     }
 *   }
 *
 * Each server is started as a child process. JSON-RPC messages are forwarded
 * to/from the process via stdin/stdout.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const configIdx = args.indexOf('--config');
const configPath = configIdx >= 0 ? args[configIdx + 1] : 'bridge-config.json';
const config = JSON.parse(readFileSync(resolve(configPath), 'utf-8'));
const PORT = config.port || 3100;

const processes = new Map();
const responseQueues = new Map();
const buffers = new Map();

function startServer(serverId, serverConfig) {
  const proc = spawn(serverConfig.command, serverConfig.args || [], {
    cwd: serverConfig.cwd || process.cwd(),
    env: { ...process.env, ...(serverConfig.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  buffers.set(serverId, '');

  proc.stdout.on('data', (data) => {
    let buf = buffers.get(serverId) + data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    buffers.set(serverId, buf);

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const queue = responseQueues.get(serverId);
        if (queue && msg.id != null) {
          const resolver = queue.get(msg.id);
          if (resolver) {
            resolver(msg);
            queue.delete(msg.id);
          }
        }
      } catch {
        // Not valid JSON, ignore
      }
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`[${serverId}] ${data.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    console.log(`[${serverId}] process exited with code ${code}`);
    processes.delete(serverId);
    responseQueues.delete(serverId);
    buffers.delete(serverId);
  });

  processes.set(serverId, proc);
  responseQueues.set(serverId, new Map());
  console.log(`[${serverId}] started (pid ${proc.pid})`);
}

function sendToProcess(serverId, jsonRpcMsg) {
  return new Promise((resolve, reject) => {
    const proc = processes.get(serverId);
    if (!proc) {
      reject(new Error(`Server ${serverId} not running`));
      return;
    }

    const queue = responseQueues.get(serverId);
    if (jsonRpcMsg.id != null && queue) {
      const timeout = setTimeout(() => {
        queue.delete(jsonRpcMsg.id);
        reject(new Error('Timeout waiting for MCP server response'));
      }, 30000);

      queue.set(jsonRpcMsg.id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    }

    proc.stdin.write(JSON.stringify(jsonRpcMsg) + '\n');

    // Notifications don't get responses
    if (jsonRpcMsg.id == null) {
      resolve(null);
    }
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/mcp\/([a-zA-Z0-9_-]+)\/?$/);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    const status = {};
    for (const [id, proc] of processes) {
      status[id] = { pid: proc.pid, running: !proc.killed };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status, servers: Object.keys(config.servers) }));
    return;
  }

  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp/<serverId>' }));
    return;
  }

  const serverId = match[1];

  if (!processes.has(serverId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Server ${serverId} not running` }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const jsonRpcMsg = JSON.parse(body);
        const response = await sendToProcess(serverId, jsonRpcMsg);

        if (response === null) {
          res.writeHead(202);
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: e.message },
          id: null,
        }));
      }
    });
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
});

// Start all configured servers
for (const [id, cfg] of Object.entries(config.servers)) {
  startServer(id, cfg);
}

server.listen(PORT, () => {
  console.log(`DA MCP Bridge running on port ${PORT}`);
  console.log(`Servers: ${Object.keys(config.servers).join(', ')}`);
});

process.on('SIGINT', () => {
  console.log('Shutting down bridge...');
  for (const [id, proc] of processes) {
    console.log(`Stopping ${id}`);
    proc.kill();
  }
  server.close();
  process.exit(0);
});
