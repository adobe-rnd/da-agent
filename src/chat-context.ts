/**
 * Session materialization: creates the typed context object that the rest
 * of handleChat (tool assembly, skill resolution, prompt building) depends on.
 *
 * Split into two phases so that the synchronous parts (adminClient,
 * pageContext, attachments) are available immediately for callers that
 * don't need collab or project memory, enabling parallel work.
 */

import { z } from 'zod';
import { DAAdminClient } from './da-admin/client.js';
import { EDSAdminClient } from './eds-admin/client.js';
import { createCollabClient, CollabClient } from './collab-client.js';
import { ensureHtmlExtension, isCollabEligibleView } from './tools/utils.js';
import { fetchProjectMemory } from './memory/loader.js';
import { ChatRequestSchema, type PageContext } from './request-schemas.js';

type ParsedBody = z.infer<typeof ChatRequestSchema>;

export interface Attachment {
  id: string;
  fileName: string;
  mediaType: string;
  dataBase64?: string;
  contentUrl?: string;
  sizeBytes?: number;
}

export interface ChatContext {
  pageContext?: PageContext;
  imsToken?: string;
  daOrigin: string;
  sourceUrl: string;
  adminClient: DAAdminClient | null;
  edsClient: EDSAdminClient | null;
  collab: CollabClient | null;
  attachmentMap: Map<string, Attachment>;
  attachments: Attachment[];
  projectMemory: string | null;
}

/**
 * Synchronous subset of ChatContext — available immediately without
 * waiting for collab or project memory.
 *
 * Defined explicitly so that new async-only fields added to ChatContext
 * require a conscious decision about which phase owns them.
 */
export interface EarlyChatContext {
  pageContext?: PageContext;
  imsToken?: string;
  daOrigin: string;
  sourceUrl: string;
  adminClient: DAAdminClient | null;
  edsClient: EDSAdminClient | null;
  attachmentMap: Map<string, Attachment>;
  attachments: Attachment[];
}

/**
 * Build the synchronous parts of ChatContext. Returns immediately —
 * no I/O, no awaits. Use this to unblock skill resolution and MCP
 * connections while collab and memory are still loading.
 */
export function buildEarlyChatContext(body: ParsedBody, env: Env): EarlyChatContext {
  const { pageContext, imsToken, attachments = [] } = body;

  const attachmentMap = new Map<string, Attachment>(
    (attachments as Attachment[]).map((a) => [a.id, a]),
  );

  const daOrigin = env.DA_ORIGIN ?? 'https://admin.da.live';
  const sourceUrl = `${daOrigin}/source/${pageContext?.org}/${pageContext?.site}/${ensureHtmlExtension(pageContext?.path ?? '')}`;

  const adminClient =
    imsToken && env.DAADMIN
      ? new DAAdminClient({ apiToken: imsToken, daadminService: env.DAADMIN })
      : null;

  const edsClient = imsToken ? new EDSAdminClient({ apiToken: imsToken }) : null;

  return {
    pageContext,
    imsToken,
    daOrigin,
    sourceUrl,
    adminClient,
    edsClient,
    attachmentMap,
    attachments: attachments as Attachment[],
  };
}

const COLLAB_TIMEOUT_MS = 3000;

/**
 * Load the async parts (collab + project memory) and produce the
 * full ChatContext. Typically run in parallel with skill resolution
 * and MCP connections.
 */
export async function resolveAsyncContext(early: EarlyChatContext, env: Env): Promise<ChatContext> {
  const { pageContext, imsToken, adminClient, sourceUrl } = early;

  // Run collab and project memory in parallel — they're independent.
  const collabPromise = connectCollab(pageContext, imsToken, sourceUrl, env);
  const memoryPromise =
    adminClient && pageContext
      ? fetchProjectMemory(adminClient, pageContext.org, pageContext.site)
      : Promise.resolve(null);

  const [collab, projectMemory] = await Promise.all([collabPromise, memoryPromise]);

  return { ...early, collab, projectMemory };
}

async function connectCollab(
  pageContext: PageContext | undefined,
  imsToken: string | undefined,
  sourceUrl: string,
  env: Env,
): Promise<CollabClient | null> {
  if (!pageContext || !isCollabEligibleView(pageContext.view) || !imsToken || !env.DACOLLAB) {
    return null;
  }

  try {
    const collabPromise = createCollabClient(sourceUrl, imsToken, pageContext.org, env.DACOLLAB);
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), COLLAB_TIMEOUT_MS);
    });
    const collab = await Promise.race([collabPromise, timeout]);
    if (!collab) {
      collabPromise.then((c) => c?.disconnect()).catch(() => {});
    }
    return collab;
  } catch {
    return null;
  }
}
