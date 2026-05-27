/**
 * Pre-LLM message transforms: approval resolution, client-only key stripping,
 * selection-context expansion, and attachment metadata injection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Resolve tool-approval-response messages into standard tool-result messages
 * so that streamText receives clean history.
 *
 * 1. Build a lookup of approvalId → tool metadata from assistant messages.
 * 2. Determine which approval-responses are "fresh" (appended by the client
 *    in this request) vs "stale" (processed in a prior request). Fresh ones
 *    sit after the last assistant/user message; stale ones have the LLM's
 *    continuation after them.
 * 3. Fresh approvals are executed; stale ones get a synthetic result.
 * 4. Strips tool-approval-request parts from assistant messages.
 */
/* eslint-disable no-await-in-loop */
export async function resolveApprovals(
  messages: any[],
  daTools: Record<string, any>,
): Promise<any[]> {
  const result: any[] = messages.map((m) => ({
    ...m,
    content: Array.isArray(m.content) ? [...m.content] : m.content,
  }));

  const approvalMeta = new Map<
    string,
    {
      toolCallId: string;
      toolName: string;
      args: any;
      msgIdx: number;
    }
  >();
  for (let i = 0; i < result.length; i += 1) {
    const msg = result[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool-approval-request') {
          const call = msg.content.find(
            (p: any) => p.type === 'tool-call' && p.toolCallId === part.toolCallId,
          );
          if (call) {
            approvalMeta.set(part.approvalId, {
              toolCallId: part.toolCallId,
              toolName: call.toolName,
              args: call.input,
              msgIdx: i,
            });
          }
        }
      }
    }
  }

  if (approvalMeta.size === 0) return result;

  let lastConversationIdx = -1;
  for (let i = result.length - 1; i >= 0; i -= 1) {
    if (result[i].role === 'assistant' || result[i].role === 'user') {
      lastConversationIdx = i;
      break;
    }
  }

  for (let i = 0; i < result.length; i += 1) {
    const msg = result[i];
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      const resp = msg.content.find((p: any) => p.type === 'tool-approval-response');
      if (resp) {
        const meta = approvalMeta.get(resp.approvalId);
        if (meta) {
          const { toolCallId, toolName, args, msgIdx } = meta;

          result[msgIdx].content = result[msgIdx].content.filter(
            (p: any) => !(p.type === 'tool-approval-request' && p.approvalId === resp.approvalId),
          );

          const alreadyResolved = result.some(
            (m) =>
              m.role === 'tool' &&
              Array.isArray(m.content) &&
              m.content.some((p: any) => p.type === 'tool-result' && p.toolCallId === toolCallId),
          );
          if (alreadyResolved) {
            // eslint-disable-next-line no-continue
            continue;
          }

          if (i < lastConversationIdx) {
            result[i] = {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId,
                  toolName,
                  output: resp.approved
                    ? { type: 'text' as const, value: '(previously executed)' }
                    : { type: 'json' as const, value: { message: 'Action rejected by user.' } },
                },
              ],
            };
          } else {
            let output: any;
            if (resp.approved && daTools[toolName]?.execute) {
              try {
                const cleanArgs = stripClientOnlyFromArgs(args);
                output = await daTools[toolName].execute(cleanArgs, { toolCallId, messages: [] });
              } catch (e) {
                output = { error: String(e) };
              }
            } else {
              output = { message: 'Action rejected by user.' };
            }

            result[i] = {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId,
                  toolName,
                  output:
                    typeof output === 'string'
                      ? { type: 'text', value: output }
                      : { type: 'json', value: output },
                },
              ],
            };
          }
        }
      }
    }
  }

  return result;
}
/* eslint-enable no-await-in-loop */

/**
 * Ensure every assistant tool-call has a matching tool-result.
 *
 * Orphaned tool-calls appear when:
 *  - The streamText step-limit fires mid-tool-execution, so the model emitted
 *    a tool_use but the SDK never appended a tool_result before stopping.
 *  - The client strips virtual (non-approval) tool results from history.
 *
 * Any unmatched tool-call gets a synthetic error result injected right after
 * its assistant message so the Anthropic/Bedrock API never sees a tool_use
 * without a corresponding tool_result.
 *
 * Counterpart: the client-side `stripOrphanedToolCallMessages` in da-nx
 * drops orphan assistant messages entirely before POSTing; this server-side
 * function injects results so the model sees an explicit failure.
 */
export function ensureOrphanedToolResults(messages: any[]): any[] {
  const resolved = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool-result' && part.toolCallId) {
          resolved.add(part.toolCallId);
        }
      }
    }
  }

  const orphans: Array<{ afterIdx: number; toolCallId: string; toolName: string }> = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    for (const part of msg.content) {
      if (part.type === 'tool-call' && part.toolCallId && !resolved.has(part.toolCallId)) {
        const toolName = part.toolName ?? '';
        if (!toolName) {
          console.warn(`[da-agent] orphaned tool-call ${part.toolCallId} has no toolName`);
        }
        orphans.push({ afterIdx: i, toolCallId: part.toolCallId, toolName });
      }
    }
  }

  if (orphans.length === 0) return messages;

  const injections = new Map<number, any[]>();
  for (const { afterIdx, toolCallId, toolName } of orphans) {
    const list = injections.get(afterIdx) ?? [];
    list.push({
      type: 'tool-result',
      toolCallId,
      toolName,
      output: {
        type: 'error-text' as const,
        value: 'Tool call was not executed (step limit reached or session interrupted).',
      },
    });
    injections.set(afterIdx, list);
  }

  const out: any[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    out.push(messages[i]);
    const parts = injections.get(i);
    if (parts) {
      out.push({ role: 'tool', content: parts });
    }
  }
  return out;
}

/**
 * Remove client-only keys (e.g. revert snapshot) from tool-call inputs
 * before the model or tool execute sees them.
 */
export function stripClientOnlyToolInputs(messages: any[]): any[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((part: any) => {
      if (part.type !== 'tool-call' || !part.input || typeof part.input !== 'object') return part;
      const input = { ...part.input };
      let stripped = false;
      Object.keys(input).forEach((k) => {
        if (k.startsWith('_da')) {
          delete input[k];
          stripped = true;
        }
      });
      if (!stripped) return part;
      changed = true;
      return { ...part, input };
    });
    return changed ? { ...m, content } : m;
  });
}

export function stripClientOnlyFromArgs(args: any): any {
  if (!args || typeof args !== 'object') return args;
  const out = { ...args };
  Object.keys(out).forEach((k) => {
    if (k.startsWith('_da')) delete out[k];
  });
  return out;
}

function formatSelectionContextForModel(items: any[]): string {
  const lines: string[] = [
    'The user attached the following excerpt(s) from the page they are editing. Treat this as authoritative context for their message. Indices refer to positions in the collaborative editor document.',
    '',
  ];
  items.forEach((item, i) => {
    const idx = typeof item?.proseIndex === 'number' ? item.proseIndex : '?';
    let label = 'Prose section';
    if (typeof item?.blockName === 'string' && item.blockName.trim()) {
      label = `Block "${item.blockName.trim()}"`;
    }
    const body = typeof item?.innerText === 'string' ? item.innerText.trim() : '';
    lines.push(`${i + 1}. ${label} (editor index: ${idx})`);
    if (body) lines.push(`   Content: ${body}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

export function expandUserSelectionContextForModel(messages: any[]): any[] {
  return messages.map((msg) => {
    if (msg.role !== 'user') return msg;
    const items = msg.selectionContext;
    if (!Array.isArray(items) || items.length === 0) {
      const rest = { ...msg };
      delete rest.selectionContext;
      return rest;
    }
    const userText = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
    const prefix = formatSelectionContextForModel(items);
    const content = `${prefix}\n\n---\n\nUser message:\n${userText}`;
    return { role: 'user', content };
  });
}

function formatAttachmentsForModel(
  items: Array<{
    id: string;
    fileName: string;
    mediaType: string;
    sizeBytes?: number;
    contentUrl?: string;
  }>,
): string {
  const pending = items.filter((i) => !i.contentUrl);
  const uploaded = items.filter((i) => i.contentUrl);
  const lines: string[] = [];

  if (pending.length > 0) {
    lines.push(
      'The user attached file(s). Binary contents are not available in chat context.',
      'If you need one for upload, call content_upload using attachmentRef from this list.',
      '',
      'Attached files:',
    );
    pending.forEach((item) => {
      const size = typeof item.sizeBytes === 'number' ? `, ${item.sizeBytes} bytes` : '';
      lines.push(`- [${item.id}] ${item.fileName} (${item.mediaType}${size})`);
    });
  }

  if (uploaded.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      'Previously uploaded files (already in DA storage — use contentUrl directly, do NOT call content_upload again):',
    );
    uploaded.forEach((item) => {
      lines.push(`- ${item.fileName}: ${item.contentUrl}`);
    });
  }

  return lines.join('\n');
}

export function expandLatestUserAttachmentsForModel(
  messages: any[],
  attachmentMeta: Array<{
    id: string;
    fileName: string;
    mediaType: string;
    sizeBytes?: number;
    contentUrl?: string;
  }>,
): any[] {
  if (!Array.isArray(attachmentMeta) || attachmentMeta.length === 0) {
    return messages.map((msg) => {
      if (msg.role !== 'user' || !msg || typeof msg !== 'object') return msg;
      const next = { ...msg };
      delete next.attachmentsMeta;
      return next;
    });
  }
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  return messages.map((msg, idx) => {
    if (msg.role !== 'user' || !msg || typeof msg !== 'object') return msg;
    const next = { ...msg };
    delete next.attachmentsMeta;
    if (idx !== lastUserIndex) return next;
    const userText = typeof next.content === 'string' ? next.content : String(next.content ?? '');
    const prefix = formatAttachmentsForModel(attachmentMeta);
    next.content = `${prefix}\n\n---\n\nUser message:\n${userText}`;
    return next;
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
