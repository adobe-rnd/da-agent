/**
 * Minimal A2A JSON-RPC handler for da-agent.
 *
 * Implements enough of the A2A spec for AO to delegate tasks:
 * - `tasks/send`          — synchronous task execution
 * - `tasks/sendSubscribe` — streaming task execution (SSE)
 *
 * Internally forwards to the existing /chat pipeline by converting
 * A2A messages to the Vercel AI SDK message format.
 */

import { CORS_HEADERS } from '../auth.js';

interface A2AMessage {
  role: string;
  parts: Array<{ type: string; text?: string }>;
}

interface A2ATaskRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: {
    id?: string;
    message?: A2AMessage;
    sessionId?: string;
  };
}

interface A2ATaskResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

function extractTextFromA2AMessage(msg: A2AMessage): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('\n');
}

function buildA2AResponse(id: string | number, taskId: string, text: string): A2ATaskResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      id: taskId,
      status: { state: 'completed' },
      artifacts: [
        {
          parts: [{ type: 'text', text }],
        },
      ],
    },
  };
}

function buildA2AError(id: string | number, code: number, message: string): A2ATaskResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

/**
 * Handle an A2A JSON-RPC request.
 *
 * For the PoC this does a lightweight internal fetch to /chat,
 * converting between A2A and Vercel AI SDK message formats.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleA2ARpc(request: Request, env: Env): Promise<Response> {
  let body: A2ATaskRequest;
  try {
    body = (await request.json()) as A2ATaskRequest;
  } catch {
    return jsonResponse(buildA2AError(0, -32700, 'Parse error'), 400);
  }

  if (!body.jsonrpc || body.jsonrpc !== '2.0') {
    return jsonResponse(buildA2AError(body.id ?? 0, -32600, 'Invalid JSON-RPC'), 400);
  }

  const { method, params, id: rpcId } = body;

  if (method === 'tasks/send' || method === 'tasks/sendSubscribe') {
    return handleTaskSend(request, env, rpcId, params, method === 'tasks/sendSubscribe');
  }

  if (method === 'tasks/get') {
    return jsonResponse(
      buildA2AError(rpcId, -32601, 'tasks/get not implemented (stateless agent)'),
    );
  }

  if (method === 'tasks/cancel') {
    return jsonResponse(buildA2AError(rpcId, -32601, 'tasks/cancel not implemented'));
  }

  return jsonResponse(buildA2AError(rpcId, -32601, `Method not found: ${method}`));
}

async function handleTaskSend(
  request: Request,
  _env: Env,
  rpcId: string | number,
  params: A2ATaskRequest['params'],
  _streaming: boolean,
): Promise<Response> {
  if (!params?.message) {
    return jsonResponse(buildA2AError(rpcId, -32602, 'Missing params.message'));
  }

  const userText = extractTextFromA2AMessage(params.message);
  if (!userText.trim()) {
    return jsonResponse(buildA2AError(rpcId, -32602, 'Empty message text'));
  }

  const taskId = params.id ?? crypto.randomUUID();

  const chatBody = {
    messages: [{ role: 'user', content: userText }],
    sessionId: params.sessionId,
  };

  try {
    const url = new URL(request.url);
    const chatUrl = `${url.protocol}//${url.host}/chat`;

    const chatResponse = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('Authorization')
          ? { Authorization: request.headers.get('Authorization')! }
          : {}),
      },
      body: JSON.stringify(chatBody),
    });

    if (!chatResponse.ok) {
      return jsonResponse(
        buildA2AError(rpcId, -32000, `Chat pipeline error: HTTP ${chatResponse.status}`),
      );
    }

    const responseText = await chatResponse.text();

    const lines = responseText.split('\n');
    const textParts: string[] = [];
    for (const line of lines) {
      if (line.startsWith('0:')) {
        try {
          textParts.push(JSON.parse(line.slice(2)));
        } catch {
          // skip non-JSON lines
        }
      }
    }

    const resultText = textParts.join('') || '(no response)';
    return jsonResponse(buildA2AResponse(rpcId, String(taskId), resultText));
  } catch (err) {
    return jsonResponse(
      buildA2AError(
        rpcId,
        -32000,
        `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}

function jsonResponse(body: A2ATaskResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
