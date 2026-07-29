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

const TOOL_OUTPUT_ENVELOPE_TYPES = new Set(['text', 'json', 'error-text']);

/**
 * resolveApprovals stores tool outputs as `{ type: 'json' | 'text' | 'error-text', value }`
 * envelopes so the model sees a well-formed tool-result. The client, however, renders cards
 * from the raw MCP output (a JSON string or object), matching what the AI SDK streams for
 * inline tool executions. Unwrap the envelope back to that raw value before emitting it.
 * Checking `type` against the known envelope tags (not just its presence) avoids mistaking
 * genuine tool output that happens to have `type`/`value` keys for our own envelope.
 */
export function unwrapToolOutput(output: unknown): unknown {
  if (
    output &&
    typeof output === 'object' &&
    'value' in output &&
    TOOL_OUTPUT_ENVELOPE_TYPES.has((output as Record<string, unknown>).type as string)
  ) {
    return (output as { value: unknown }).value;
  }
  return output;
}

/** A `data-continuation` transient stream part driving the client's Continue/Stop prompt. */
export interface ContinuationPart {
  type: 'data-continuation';
  transient: true;
  data: { toolCallId: string; toolName: string };
}

interface StepLike {
  toolCalls: Array<{ toolCallId: string; toolName: string }>;
  toolResults: Array<{ toolCallId: string }>;
}

/**
 * The transient continuation parts to emit for the given (final) step: one per
 * continuation-gated tool that actually produced a result in this step. A gated tool
 * with no result (e.g. it was itself pre-execution-paused and never ran) is skipped so
 * we never prompt "continue?" for a tool that hasn't finished.
 */
export function buildContinuationParts(
  lastStep: StepLike | undefined,
  requiresContinuationApproval: (toolName: string) => boolean,
): ContinuationPart[] {
  if (!lastStep) return [];
  const resultIds = new Set(lastStep.toolResults.map((r) => r.toolCallId));
  const parts: ContinuationPart[] = [];
  for (const tc of lastStep.toolCalls) {
    if (requiresContinuationApproval(tc.toolName) && resultIds.has(tc.toolCallId)) {
      parts.push({
        type: 'data-continuation',
        transient: true,
        data: { toolCallId: tc.toolCallId, toolName: tc.toolName },
      });
    }
  }
  return parts;
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
          output: unwrapToolOutput(output),
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
