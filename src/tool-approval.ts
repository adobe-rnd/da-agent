import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';

/** Tool-call IDs that already have a tool-result in the message history. */
export function resolvedToolCallIds(messages: any[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool-result' && part.toolCallId) {
          ids.add(part.toolCallId);
        }
      }
    }
  }
  return ids;
}

/** True when an assistant turn still has tool-approval-request parts awaiting a tool-result. */
export function hasPendingApprovals(messages: any[]): boolean {
  const resolved = resolvedToolCallIds(messages);
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          part.type === 'tool-approval-request' &&
          part.toolCallId &&
          !resolved.has(part.toolCallId)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Tool results produced during this request (not present in the incoming history). */
export function getNewlyResolvedToolOutputs(
  originalMessages: any[],
  processedMessages: any[],
): Array<{ toolCallId: string; output: unknown }> {
  const originalIds = resolvedToolCallIds(originalMessages);
  const outputs: Array<{ toolCallId: string; output: unknown }> = [];
  const seen = new Set<string>();
  for (const msg of processedMessages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          part.type === 'tool-result' &&
          part.toolCallId &&
          !originalIds.has(part.toolCallId) &&
          !seen.has(part.toolCallId)
        ) {
          seen.add(part.toolCallId);
          outputs.push({ toolCallId: part.toolCallId, output: part.output });
        }
      }
    }
  }
  return outputs;
}

export function buildApprovalContinuationResponse(
  toolOutputs: Array<{ toolCallId: string; output: unknown }>,
  corsHeaders: Record<string, string>,
): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      for (const { toolCallId, output } of toolOutputs) {
        writer.write({
          type: 'tool-output-available',
          toolCallId,
          output,
        });
      }
      writer.write({ type: 'finish', finishReason: 'stop' });
    },
  });

  const streamResponse = createUIMessageStreamResponse({ stream });
  const headers = new Headers(streamResponse.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers,
  });
}
