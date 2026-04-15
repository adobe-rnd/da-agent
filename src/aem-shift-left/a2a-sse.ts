/**
 * Parse A2A JSON-RPC over SSE (Server-Sent Events), aligned with aem-shift-left A2ATestClient.
 */
/* eslint-disable no-continue, no-await-in-loop -- incremental SSE line parser */

export function extractTextFromA2AResult(result: Record<string, unknown>): string | null {
  const kind = String(result.kind || '');
  let parts: unknown[];
  if (kind === 'status-update') {
    const status = result.status as { message?: { parts?: unknown[] } } | undefined;
    parts = status?.message?.parts ?? [];
  } else if (kind === 'message') {
    parts = (result.parts as unknown[]) ?? [];
  } else {
    return null;
  }
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const pk = String(p.kind || '');
    if (pk === 'text') {
      const text = String(p.text || '');
      if (text && text !== 'Processing...') return text;
    }
    if (pk === 'data') {
      const data = p.data as { type?: string; default?: { text?: string } } | undefined;
      if (data?.type === 'reasoning') {
        const text = data.default?.text;
        if (text) return String(text);
      }
    }
  }
  return null;
}

export type A2AStreamResult = {
  message: string;
  status: string;
  context_id?: string;
  intermediate_updates: string[];
  final_updates: string[];
};

/**
 * Consume an SSE response body from POST .../a2a/ (message/stream).
 */
export async function parseA2aSseResponse(
  body: ReadableStream<Uint8Array>,
): Promise<A2AStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastMessageText = '';
  let taskStatus = 'running';
  let contextId: string | undefined;
  const intermediate: string[] = [];
  const finalUpdates: string[] = [];
  let terminated = false;

  while (!terminated) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() ?? '');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('event:')) continue;
      if (!trimmed.startsWith('data:')) continue;
      let data: unknown;
      try {
        data = JSON.parse(trimmed.slice(5).trim());
      } catch {
        continue;
      }
      const d = data as Record<string, unknown>;
      if (d.error) {
        const err = d.error as { message?: string };
        await reader.cancel().catch(() => {});
        throw new Error(err.message || 'A2A error');
      }
      const result = d.result as Record<string, unknown> | undefined;
      if (!result) continue;
      if (typeof result.contextId === 'string') contextId = result.contextId;

      const isFinal = result.final === true;
      const text = extractTextFromA2AResult(result);
      if (text) {
        lastMessageText = text;
        if (isFinal) finalUpdates.push(text);
        else intermediate.push(text);
      } else if (result.kind === 'status-update' && !isFinal) {
        const state = (result.status as { state?: string } | undefined)?.state;
        if (state) intermediate.push(state);
      }
      if (isFinal) {
        taskStatus = 'completed';
        terminated = true;
        break;
      }
    }
    if (done && !terminated) break;
  }

  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }

  return {
    message: lastMessageText || 'No response from agent',
    status: taskStatus,
    ...(contextId ? { context_id: contextId } : {}),
    intermediate_updates: intermediate,
    final_updates: finalUpdates,
  };
}

export type SendA2AOptions = {
  /** When true, logs one line to stderr (Wrangler terminal) before the outbound fetch. */
  logCall?: boolean;
};

export async function sendA2AMessageStream(
  a2aBaseUrl: string,
  imsToken: string,
  text: string,
  contextId?: string,
  options?: SendA2AOptions,
): Promise<A2AStreamResult> {
  const trimmedBase = a2aBaseUrl.replace(/\/$/, '');
  if (options?.logCall) {
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    console.log(
      `[da-agent] AEM shift-left A2A → POST ${trimmedBase}/  (message/stream, context=${contextId ? 'yes' : 'no'}) instruction: ${JSON.stringify(preview)}`,
    );
  }
  const requestId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const messageObj: Record<string, unknown> = {
    messageId,
    role: 'user',
    parts: [{ kind: 'text', text }],
  };
  if (contextId) messageObj.contextId = contextId;

  const rpc = {
    jsonrpc: '2.0',
    method: 'message/stream',
    params: { message: messageObj },
    id: requestId,
  };

  const resp = await fetch(`${trimmedBase}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${imsToken}`,
    },
    body: JSON.stringify(rpc),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`A2A HTTP ${resp.status}: ${t.slice(0, 500)}`);
  }
  if (!resp.body) {
    throw new Error('A2A response has no body');
  }
  return parseA2aSseResponse(resp.body);
}
