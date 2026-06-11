/**
 * AO chat adapter — thin protocol bridge.
 *
 * Translates between the Vercel AI SDK UIMessageStream format (used by da-nx)
 * and AO's A2A JSON-RPC SSE format, so da-agent can proxy chat to AO when
 * the harness toggle is set to "ao".
 *
 * Flow: da-nx → POST /chat { harness: "ao" } → da-agent → POST /a2a/rpc → AO
 * Response: AO SSE → translate → Vercel AI SDK SSE → da-nx readStream()
 */

import { CORS_HEADERS, extractImsUserId } from '../auth.js';

const IMS_IDENTITY_URI = 'https://ns.adobe.com/a2a/extensions/adobe/ims-identity/v0';
const CONVERSATION_URI = 'https://ns.adobe.com/a2a/extensions/adobe/dx/conversation-correlation/v0';

export interface AOProxyChatInput {
  messages: Array<{ role: string; content: unknown }>;
  imsToken?: string;
  sessionId?: string;
}

function extractLatestUserMessage(messages: Array<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const text = (msg.content as Array<Record<string, unknown>>)
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('\n');
        if (text) return text;
      }
    }
  }
  return '';
}

/**
 * Decode IMS org ID from the JWT payload. Returns undefined if not present.
 * IMS tokens may carry the org in `other_orgs`, `client_id`, or `as` claims.
 */
function extractImsOrgId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    if (decoded.ims_org_id) return decoded.ims_org_id;
    if (typeof decoded.as === 'string' && decoded.as.includes('@')) return decoded.as;
    const orgs = decoded.other_orgs;
    if (Array.isArray(orgs) && orgs.length > 0) return orgs[0];
    return undefined;
  } catch {
    return undefined;
  }
}

function emitSSE(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

/**
 * Read AO SSE events and re-emit as Vercel AI SDK UIMessageStream events.
 *
 * AO event kinds:
 *   TaskArtifactUpdateEvent (artifact-update) → text-delta for TextParts
 *   TaskStatusUpdateEvent (status-update) → surface failures to the user
 *   Task (kind=task, final result) → text-end + finish-message
 *   JSON-RPC error → text-delta with error message
 */
function processAOSseLine(
  line: string,
  hasText: boolean,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): { hasText: boolean; done: boolean } {
  const isMetaLine = line.startsWith('event:') || line.startsWith('id:');
  const raw = line.startsWith('data: ') ? line.slice(6).trim() : line.trim();

  if (isMetaLine || !raw || raw === '[DONE]') {
    return { hasText, done: false };
  }

  console.log(`[da-agent:ao-sse] ${raw.slice(0, 300)}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { hasText, done: false };
  }

  if (parsed.error) {
    const err = parsed.error as Record<string, unknown>;
    emitSSE(controller, encoder, {
      type: 'text-delta',
      textDelta: `AO error: ${err.message || JSON.stringify(err)}`,
    });
    emitSSE(controller, encoder, { type: 'text-end' });
    emitSSE(controller, encoder, { type: 'finish-message' });
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
    return { hasText: true, done: true };
  }

  const result = parsed.result as Record<string, unknown> | undefined;
  if (!result) return { hasText, done: false };

  const kind = result.kind as string | undefined;
  let newHasText = hasText;

  if (kind === 'artifact-update') {
    const artifact = result.artifact as Record<string, unknown> | undefined;
    const parts = (artifact?.parts ?? []) as Array<Record<string, unknown>>;
    for (const part of parts) {
      if (part.kind === 'text' && part.text) {
        newHasText = true;
        emitSSE(controller, encoder, { type: 'text-delta', textDelta: part.text });
      }
    }
  } else if (kind === 'status-update') {
    const status = result.status as Record<string, unknown> | undefined;
    if (status?.state === 'failed' && result.final === true) {
      const msg = (status.message as string) || 'AO session failed (no details provided).';
      emitSSE(controller, encoder, { type: 'text-delta', textDelta: msg });
      emitSSE(controller, encoder, { type: 'text-end' });
      emitSSE(controller, encoder, { type: 'finish-message' });
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      return { hasText: true, done: true };
    }
  } else if (kind === 'task') {
    const artifacts = (result.artifacts ?? []) as Array<Record<string, unknown>>;
    for (const artifact of artifacts) {
      const parts = (artifact.parts ?? []) as Array<Record<string, unknown>>;
      for (const part of parts) {
        if (part.kind === 'text' && part.text) {
          newHasText = true;
          emitSSE(controller, encoder, { type: 'text-delta', textDelta: part.text as string });
        }
      }
    }
    if (newHasText) emitSSE(controller, encoder, { type: 'text-end' });
    emitSSE(controller, encoder, { type: 'finish-message' });
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
    return { hasText: newHasText, done: true };
  }

  return { hasText: newHasText, done: false };
}

function createTranslatingStream(aoResponse: Response): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = aoResponse.body!.getReader();

  let buffer = '';
  let hasText = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          if (hasText) emitSSE(controller, encoder, { type: 'text-end' });
          emitSSE(controller, encoder, { type: 'finish-message' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const result = processAOSseLine(line, hasText, controller, encoder);
          hasText = result.hasText;
          if (result.done) return;
        }
      } catch (err) {
        emitSSE(controller, encoder, {
          type: 'error',
          errorText: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

/**
 * Proxy a chat request to the AO backend via A2A `message/stream`,
 * translating the response back to Vercel AI SDK format.
 */
export async function handleAOProxiedChat(
  input: AOProxyChatInput,
  aoBackendUrl: string,
): Promise<Response> {
  const userText = extractLatestUserMessage(input.messages);
  if (!userText) {
    return new Response(JSON.stringify({ error: 'No user message found' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const rpcId = `da-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const contextId = input.sessionId || `da-ctx-${Date.now()}`;

  const userId = extractImsUserId(input.imsToken) ?? 'anonymous';
  const orgId = extractImsOrgId(input.imsToken);

  // Debug: log JWT claims to determine what fields are available
  if (input.imsToken) {
    try {
      const payload = input.imsToken.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      console.log('[da-agent:ao-adapter] JWT claims:', Object.keys(decoded).join(', '));
    } catch {
      /* ignore */
    }
  }

  // Build Adobe A2A extensions metadata (required by AO when auth.provider = ims)
  const metadata: Record<string, unknown> = {};
  if (orgId) {
    metadata[IMS_IDENTITY_URI] = {
      imsOrgId: orgId,
      imsUserId: userId,
    };
  }
  metadata[CONVERSATION_URI] = {
    conversationId: contextId,
    interactionId: messageId,
  };

  const a2aRequest = {
    jsonrpc: '2.0' as const,
    id: rpcId,
    method: 'message/stream' as const,
    params: {
      message: {
        messageId,
        role: 'user' as const,
        parts: [{ kind: 'text' as const, text: userText }],
        contextId,
        metadata,
      },
      configuration: {
        acceptedOutputModes: ['text', 'text/plain'],
        blocking: false,
      },
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (input.imsToken) {
    headers.Authorization = `Bearer ${input.imsToken}`;
  }
  // Identity headers as fallback for AO's header-based auth path
  headers['x-user-id'] = userId;
  if (orgId) {
    headers['x-tenant-id'] = orgId;
    headers['x-gw-ims-org-id'] = orgId;
  }

  console.log(
    `[da-agent:ao-adapter] proxying to ${aoBackendUrl}/a2a/rpc, userId=${userId}, orgId=${orgId ?? 'none'}`,
  );

  let aoResp: Response;
  try {
    aoResp = await fetch(`${aoBackendUrl.replace(/\/+$/, '')}/a2a/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify(a2aRequest),
    });
  } catch (err) {
    console.error('[da-agent:ao-adapter] AO backend unreachable:', err);
    return new Response(JSON.stringify({ error: 'AO backend unreachable' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const contentType = aoResp.headers.get('content-type') ?? '';
  console.log(`[da-agent:ao-adapter] AO responded ${aoResp.status}, content-type=${contentType}`);

  if (!aoResp.ok) {
    const errText = await aoResp.text().catch(() => 'Unknown error');
    console.error(`[da-agent:ao-adapter] AO returned ${aoResp.status}: ${errText}`);
    return new Response(JSON.stringify({ error: `AO backend error: ${aoResp.status}` }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // AO may return JSON (synchronous/error) or SSE (streaming)
  if (contentType.includes('application/json')) {
    return handleAOJsonResponse(aoResp);
  }

  return new Response(createTranslatingStream(aoResp), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

async function handleAOJsonResponse(aoResp: Response): Promise<Response> {
  const encoder = new TextEncoder();

  let body: Record<string, unknown>;
  try {
    body = (await aoResp.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse AO JSON response' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  console.log('[da-agent:ao-adapter] JSON response:', JSON.stringify(body).slice(0, 500));

  let text = '';
  const result = body.result as Record<string, unknown> | undefined;
  if (result) {
    const artifacts = (result.artifacts ?? []) as Array<Record<string, unknown>>;
    for (const artifact of artifacts) {
      const parts = (artifact.parts ?? []) as Array<Record<string, unknown>>;
      for (const part of parts) {
        if (part.kind === 'text' && typeof part.text === 'string') text += part.text;
      }
    }
    if (!text) {
      const status = result.status as Record<string, unknown> | undefined;
      if (status?.message && typeof status.message === 'string') {
        text = status.message;
      }
    }
  }
  if (!text && body.error) {
    const err = body.error as Record<string, unknown>;
    text = `AO error: ${err.message || JSON.stringify(err)}`;
  }
  if (!text) {
    text = 'AO returned an empty response.';
  }

  const events = [
    `data: ${JSON.stringify({ type: 'text-delta', textDelta: text })}\n\n`,
    `data: ${JSON.stringify({ type: 'text-end' })}\n\n`,
    `data: ${JSON.stringify({ type: 'finish-message' })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');

  return new Response(encoder.encode(events), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
