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
    'The user attached the following excerpt(s) from the page they are editing. Treat this as authoritative context for their message. Indices refer to positions in the collaborative editor document. Text-type items contain HTML preserving the original structure (marks, images, partial blocks).',
    '',
  ];
  items.forEach((item, i) => {
    const idx = typeof item?.proseIndex === 'number' ? item.proseIndex : '?';
    const type = item?.type === 'text' ? 'text' : 'block';
    if (type === 'text') {
      const html = typeof item?.innerHTML === 'string' ? item.innerHTML.trim() : '';
      lines.push(`${i + 1}. Text selection (editor index: ${idx})`);
      if (html) lines.push(`   HTML: ${html}`);
    } else {
      const label =
        typeof item?.blockName === 'string' && item.blockName.trim()
          ? `Block "${item.blockName.trim()}"`
          : 'Prose section';
      const body = typeof item?.innerText === 'string' ? item.innerText.trim() : '';
      lines.push(`${i + 1}. ${label} (editor index: ${idx})`);
      if (body) lines.push(`   Content: ${body}`);
    }
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

function isMarkdown(item: { mediaType: string; fileName: string }): boolean {
  return item.mediaType === 'text/markdown' || item.fileName.toLowerCase().endsWith('.md');
}

const MAX_INLINE_BYTES = 50_000;

function formatAttachmentsForModel(
  items: Array<{
    id: string;
    fileName: string;
    mediaType: string;
    dataBase64?: string;
    sizeBytes?: number;
    contentUrl?: string;
  }>,
): string {
  const pending = items.filter((i) => !i.contentUrl);
  const uploaded = items.filter((i) => i.contentUrl);
  const lines: string[] = [];

  const readable = pending.filter(
    (i) =>
      isMarkdown(i) && i.dataBase64 && (i.sizeBytes == null || i.sizeBytes <= MAX_INLINE_BYTES),
  );
  const uploadOnly = pending.filter((i) => !readable.includes(i));

  readable.forEach((item) => {
    let content: string;
    try {
      const bytes = Uint8Array.from(globalThis.atob(item.dataBase64!), (c) => c.charCodeAt(0));
      content = new TextDecoder().decode(bytes);
    } catch (e) {
      console.warn(`[da-agent] Failed to decode base64 for ${item.fileName}:`, e);
      uploadOnly.push(item);
      return;
    }
    lines.push(
      `Attached markdown file: ${item.fileName}`,
      '---',
      content.trim(),
      '---',
      `To store this file in DA, call content_upload using attachmentRef [${item.id}].`,
      '',
    );
  });

  if (uploadOnly.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      'The user attached file(s). Binary contents are not available in chat context.',
      'If you need one for upload, call content_upload using attachmentRef from this list.',
      '',
      'Attached files:',
    );
    uploadOnly.forEach((item) => {
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
    dataBase64?: string;
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
