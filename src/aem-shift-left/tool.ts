import { tool } from 'ai';
import { z } from 'zod';
import { sendA2AMessageStream } from './a2a-sse.js';

/**
 * When `AEM_SHIFT_LEFT_A2A_URL` is set (e.g. https://&lt;host&gt;/a2a), exposes a tool that
 * forwards requests to the aem-shift-left A2A server using the user's IMS token.
 */
export type CreateAemShiftLeftToolsOptions = {
  /** Log each A2A call (use with local `wrangler dev` / ENVIRONMENT=dev). */
  logA2aCalls?: boolean;
};

export function createAemShiftLeftTools(
  a2aUrl: string | undefined,
  imsToken: string | undefined,
  toolOptions?: CreateAemShiftLeftToolsOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vercel AI tool map
): Record<string, any> {
  const base = a2aUrl?.trim();
  const logA2aCalls = toolOptions?.logA2aCalls === true;
  if (!base) return {};

  return {
    aem_shift_left_content_create: tool({
      description:
        'Invoke the AEM shift-left experience-generation agent (A2A) to create or update content from a natural-language instruction. Use when the user wants AEM / Edge / shift-left style page creation or updates routed to that stack. Returns agent text and optional context_id for HITL follow-up.',
      inputSchema: z.object({
        instruction: z
          .string()
          .describe('What to create or change (include URLs, paths, or briefs when known)'),
        context_id: z
          .string()
          .optional()
          .describe(
            'Conversation id from a prior aem_shift_left_content_create result to continue HITL',
          ),
      }),
      execute: async ({ instruction, context_id: contextId }) => {
        if (!imsToken) {
          return { error: 'IMS token required to call AEM shift-left A2A' };
        }
        try {
          const out = await sendA2AMessageStream(base, imsToken, instruction, contextId, {
            logCall: logA2aCalls,
          });
          return out;
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e) };
        }
      },
    }),
  };
}
