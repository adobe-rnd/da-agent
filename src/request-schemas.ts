import { z } from 'zod';

export const PageContextSchema = z.object({
  org: z.string(),
  site: z.string(),
  path: z.string(),
  view: z.string().optional(),
});

export type PageContext = z.infer<typeof PageContextSchema>;

/** Per MCP server: either a list of { name, value } or a header name → value map. */
const McpServerHeaderListSchema = z.array(z.object({ name: z.string().min(1), value: z.string() }));

export const McpServerHeadersValueSchema = z.union([
  McpServerHeaderListSchema,
  z.record(z.string(), z.string()),
]);

/**
 * Normalize client MCP header payloads to a single Record for RemoteMCPServerConfig.
 */
export function normalizeMcpHeadersInput(
  input: z.infer<typeof McpServerHeadersValueSchema> | undefined,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (Array.isArray(input)) {
    if (input.length === 0) return undefined;
    return Object.fromEntries(input.map(({ name, value }) => [name, value]));
  }
  if (Object.keys(input).length === 0) return undefined;
  return input;
}

export const ChatRequestSchema = z.object({
  messages: z.array(z.any()),
  pageContext: PageContextSchema.optional(),
  imsToken: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().min(1).max(128).optional(),
  requestedSkills: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), z.string()).optional(),
  /** Optional HTTP headers per server id (keys must match mcpServers). Sent on every MCP request to that URL. */
  mcpServerHeaders: z.record(z.string(), McpServerHeadersValueSchema).optional(),
  attachments: z
    .array(
      z
        .object({
          id: z.string().min(1),
          fileName: z.string().min(1),
          mediaType: z.string().min(1),
          /** Raw bytes for first-time upload. Omit on approval continuations when the file is already uploaded. */
          dataBase64: z.string().min(1).optional(),
          /** DA storage URL returned by a previous content_upload call. Replaces dataBase64 on approval continuations. */
          contentUrl: z.string().min(1).optional(),
          sizeBytes: z.number().int().nonnegative().optional(),
        })
        .refine((a) => a.dataBase64 || a.contentUrl, {
          message: 'Each attachment must have either dataBase64 or contentUrl',
        }),
    )
    .optional(),
});

export const McpToolsRequestSchema = z.object({
  servers: z.record(z.string(), z.string()),
  /** Optional HTTP headers per server id (keys should match servers). */
  serverHeaders: z.record(z.string(), McpServerHeadersValueSchema).optional(),
});
