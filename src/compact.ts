/**
 * Auto-compact: token estimation, threshold detection, skill content,
 * and the compact_context tool definition.
 */

import { tool } from 'ai';
import { z } from 'zod';

/** Model context-window size in tokens (Claude Sonnet 4). */
export const MODEL_CONTEXT_WINDOW = 1_000_000;

/** Default auto-compact threshold (fraction of context window). */
export const DEFAULT_COMPACT_THRESHOLD = 0.75;

/** Approximate characters per token for English + code mixed content. */
const CHARS_PER_TOKEN = 3.5;

/**
 * Rough token estimate from character count. Uses ~3.5 chars/token heuristic,
 * sufficient for the compact trigger decision (not billing-accurate).
 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * Resolve the effective compact threshold from an optional env override.
 * Returns the override if it's a valid number in (0, 1), otherwise the default.
 */
export function resolveCompactThreshold(envOverride?: string): number {
  const parsed = parseFloat(envOverride ?? '');
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_COMPACT_THRESHOLD;
}

/**
 * Determine whether auto-compact should trigger. Estimates total tokens
 * from the serialised messages AND the system prompt (which includes
 * skills, agent instructions, MCP config, etc.).
 */
export function shouldAutoCompact(
  modelMessages: unknown[],
  systemPrompt: string,
  threshold: number,
): boolean {
  const totalChars = JSON.stringify(modelMessages).length + systemPrompt.length;
  return estimateTokens(totalChars) > Math.floor(MODEL_CONTEXT_WINDOW * threshold);
}

/**
 * Build the system-prompt section that instructs the model to compact immediately.
 * Uses the actual effective threshold so the message is accurate even with env overrides.
 */
export function buildAutoCompactSection(effectiveThreshold: number): string {
  const pct = Math.round(effectiveThreshold * 100);
  const capacity = MODEL_CONTEXT_WINDOW / 1_000;
  return (
    `\n\n## [AUTO-COMPACT TRIGGERED]\n` +
    `The conversation has reached ${pct}% of the model context-window capacity (${capacity}K tokens). ` +
    `You MUST call the \`compact_context\` tool immediately, before responding to anything else, ` +
    `using the instructions in the **Compact Context** skill pre-loaded above.`
  );
}

/**
 * Compact skill content — single source of truth (no separate .md file).
 * Referenced project memory for site context rather than duplicating it.
 */
export const COMPACT_SKILL = `# Compact Context

Condenses the current conversation into a concise, structured summary that preserves all essential context while freeing space in the context window.

## When to use

- The system prompt signals **[AUTO-COMPACT TRIGGERED]**.
- The user explicitly asks to compact, summarize, or clear the conversation history.

## How to compact

Call the \`compact_context\` tool with a markdown summary that covers **all five** of these sections. Be thorough — the summary is the only record of what was discussed.

### Required summary sections

\`\`\`
# Conversation Summary

## Active task
One sentence: what is the user trying to accomplish right now?

## Site context
Reference the project memory for persistent site info (purpose, main URLs, templates).
Only include here: the current page path, any ephemeral navigation context, or
session-specific discoveries not yet persisted to project memory.

## Work completed
Bullet list of every concrete action taken: pages created or updated, content written, tools called and their outcomes. Include file paths.

## Pending items
What still needs to be done to finish the user's request, if anything.

## Key facts & preferences
Brand rules, style constraints, naming conventions, or explicit preferences the user stated during this session. Only facts that would change future decisions and aren't already in project memory.
\`\`\`

## After compacting

After \`compact_context\` returns:
1. Tell the user in one sentence that the conversation was compacted and their work is safe.
2. Show the **Active task** and **Pending items** sections so they know where you left off.
3. Continue helping — the summary has been emitted to the client. If the client supports compaction, the message history will be trimmed to this summary on the next turn.
`;

/**
 * Creates the compact_context tool. Only registered when auto-compact triggers.
 */
export function createCompactTools() {
  return {
    compact_context: tool({
      description:
        'Produce and emit a compact summary of the entire conversation history to free context-window space. ' +
        'Call this whenever the compact skill is active (auto-triggered or user-requested). ' +
        'The summary must capture: active task, site context, work completed, pending items, and key facts. ' +
        'After this tool returns, briefly tell the user the conversation was compacted, then continue helping.',
      inputSchema: z.object({
        summary: z
          .string()
          .min(1)
          .describe(
            'Full markdown summary using the five required sections from the compact skill: ' +
              'Active task, Site context, Work completed, Pending items, Key facts & preferences.',
          ),
      }),
      execute: async ({ summary }) => ({ compacted: true, summary }),
    }),
  };
}
