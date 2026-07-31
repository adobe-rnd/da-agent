/**
 * Pre-LLM message transforms for the v2 approval protocol: approval
 * reconciliation, v2→model-message conversion, client-only key stripping,
 * selection-context expansion, and attachment metadata injection.
 *
 * The client↔agent wire contract lives in da-nx/docs/approval-protocol.md.
 * Incoming assistant messages carry `type: 'tool'` parts whose lifecycle
 * `state` is the single key we reconcile on (never message position).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TOOL_STATE = {
  INPUT_AVAILABLE: 'input-available',
  AWAITING_APPROVAL: 'awaiting-approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  OUTPUT_AVAILABLE: 'output-available',
  OUTPUT_ERROR: 'output-error',
} as const;

const REJECTION_MESSAGE = 'Action rejected by user.';

const isToolPart = (p: any) => p?.type === 'tool';
const partHasResult = (p: any) =>
  p.state === TOOL_STATE.OUTPUT_AVAILABLE || p.state === TOOL_STATE.OUTPUT_ERROR;

function wrapOutput(raw: any): { type: 'text' | 'json'; value: any } {
  return typeof raw === 'string'
    ? { type: 'text', value: raw }
    : { type: 'json', value: raw ?? null };
}

export interface ExecutedOutput {
  toolCallId: string;
  output?: unknown;
  errorText?: string;
  isError: boolean;
}

/**
 * Reconcile the v2 history before the model runs: execute every tool part the
 * user approved that has no result yet, **sequentially** (deterministic
 * ordering, no races on da-admin/collab — see approval-protocol.md §7), and
 * attach each result back onto its part. Rejections are left as-is here (they
 * carry no execution) and become a rejection tool-result at model-conversion
 * time. Returns the updated messages plus the outputs to stream to the client
 * so it can move each approved card to its result state.
 */
/* eslint-disable no-await-in-loop */
export async function reconcileApprovals(
  messages: any[],
  daTools: Record<string, any>,
): Promise<{ messages: any[]; executedOutputs: ExecutedOutput[] }> {
  const toExecute: any[] = [];
  messages.forEach((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return;
    msg.content.forEach((p: any) => {
      if (isToolPart(p) && p.state === TOOL_STATE.APPROVED && !partHasResult(p)) {
        toExecute.push(p);
      }
    });
  });

  const executedOutputs: ExecutedOutput[] = [];
  const resultsById = new Map<string, any>();

  for (const part of toExecute) {
    const tool = daTools[part.toolName];
    if (!tool?.execute) {
      const errorText = `No executable tool: ${part.toolName}`;
      resultsById.set(part.toolCallId, { state: TOOL_STATE.OUTPUT_ERROR, errorText });
      executedOutputs.push({ toolCallId: part.toolCallId, isError: true, errorText });
      // eslint-disable-next-line no-continue
      continue;
    }
    try {
      const cleanArgs = stripClientOnlyFromArgs(part.input);
      const output = await tool.execute(cleanArgs, { toolCallId: part.toolCallId, messages: [] });
      resultsById.set(part.toolCallId, { state: TOOL_STATE.OUTPUT_AVAILABLE, output });
      executedOutputs.push({ toolCallId: part.toolCallId, output, isError: false });
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      resultsById.set(part.toolCallId, { state: TOOL_STATE.OUTPUT_ERROR, errorText });
      executedOutputs.push({ toolCallId: part.toolCallId, isError: true, errorText });
    }
  }

  if (resultsById.size === 0) return { messages, executedOutputs };

  const out = messages.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    const touched = msg.content.some((p: any) => isToolPart(p) && resultsById.has(p.toolCallId));
    if (!touched) return msg;
    const content = msg.content.map((p: any) =>
      isToolPart(p) && resultsById.has(p.toolCallId)
        ? { ...p, ...resultsById.get(p.toolCallId) }
        : p,
    );
    return { ...msg, content };
  });
  return { messages: out, executedOutputs };
}
/* eslint-enable no-await-in-loop */

/**
 * Convert v2 wire messages into provider ModelMessages. Each `type: 'tool'`
 * part expands into an assistant `tool-call` and, when it has a settled state,
 * a `tool` role `tool-result`:
 *   - output-available → the tool output
 *   - output-error     → an error-text result
 *   - rejected         → a "rejected by user" result (so the tool_use isn't orphaned)
 * Parts with no result yet (should not occur after reconcileApprovals) are left
 * unresolved for ensureOrphanedToolResults to backfill. Client-only `_da*` keys
 * are stripped from tool inputs here.
 */
export function toModelMessages(messages: any[]): any[] {
  const out: any[] = [];
  messages.forEach((msg) => {
    if (msg.role === 'user') {
      out.push(msg);
      return;
    }
    if (msg.role !== 'assistant') return;
    if (typeof msg.content === 'string') {
      out.push({ role: 'assistant', content: msg.content });
      return;
    }
    if (!Array.isArray(msg.content)) {
      out.push(msg);
      return;
    }

    const assistantContent: any[] = [];
    const toolResults: any[] = [];
    msg.content.forEach((part: any) => {
      if (part.type === 'text') {
        assistantContent.push({ type: 'text', text: part.text });
        return;
      }
      if (!isToolPart(part)) return;
      assistantContent.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: stripClientOnlyFromArgs(part.input),
      });
      let output: any;
      if (part.state === TOOL_STATE.OUTPUT_AVAILABLE) output = wrapOutput(part.output);
      else if (part.state === TOOL_STATE.OUTPUT_ERROR) {
        output = { type: 'error-text', value: part.errorText ?? 'Tool error' };
      } else if (part.state === TOOL_STATE.REJECTED) {
        output = { type: 'json', value: { message: REJECTION_MESSAGE } };
      }
      if (output !== undefined) {
        toolResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output,
        });
      }
    });

    if (assistantContent.length) out.push({ role: 'assistant', content: assistantContent });
    if (toolResults.length) out.push({ role: 'tool', content: toolResults });
  });
  return out;
}

/**
 * Ensure every assistant tool-call has a matching tool-result.
 *
 * Orphaned tool-calls appear when the streamText step-limit fires
 * mid-tool-execution, so the model emitted a tool_use but the SDK never
 * appended a tool_result before stopping. Any unmatched tool-call gets a
 * synthetic error result injected right after its assistant message so the
 * Anthropic/Bedrock API never sees a tool_use without a tool_result.
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
    'The user attached the following excerpt(s) from the page they are editing. Treat this as authoritative context for their message. Indices refer to positions in the collaborative editor document. Text-type items contain HTML preserving the original structure (marks, images, partial blocks).',
    '',
  ];
  items.forEach((item, i) => {
    const type = item?.type;
    const idx = typeof item?.proseIndex === 'number' ? item.proseIndex : '?';
    const name = typeof item?.blockName === 'string' ? item.blockName.trim() : '';
    const body = typeof item?.innerText === 'string' ? item.innerText.trim() : '';
    if (type === 'text') {
      const html = typeof item?.innerHTML === 'string' ? item.innerHTML.trim() : '';
      lines.push(`${i + 1}. Text selection (editor index: ${idx})`);
      if (html) lines.push(`   HTML: ${html}`);
    } else if (type === 'file' || type === 'folder') {
      const kind = type === 'file' ? 'File' : 'Folder';
      lines.push(`${i + 1}. ${name ? `${kind} "${name}"` : kind}`);
      if (body) lines.push(`   Content: ${body}`);
    } else {
      const label = name ? `Block "${name}"` : 'Prose section';
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
