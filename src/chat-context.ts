/**
 * Session materialization: creates the typed context object that the rest
 * of handleChat (tool assembly, skill resolution, prompt building) depends on.
 *
 * NEW MODULE — extracted from server.ts handleChat.
 * Logic is identical to the original except the ChatContext interface
 * and buildChatContext function signature are new structural additions.
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
  dataBase64: string;
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

export async function buildChatContext(body: ParsedBody, env: Env): Promise<ChatContext> {
  const { pageContext, imsToken, attachments = [] } = body;

  const attachmentMap = new Map(attachments.map((a) => [a.id, a]));

  const daOrigin = env.DA_ORIGIN ?? 'https://admin.da.live';
  const sourceUrl = `${daOrigin}/source/${pageContext?.org}/${pageContext?.site}/${ensureHtmlExtension(pageContext?.path ?? '')}`;

  // NEW: added explicit pageContext narrowing to fix pre-existing TS18048
  const collab =
    pageContext && isCollabEligibleView(pageContext.view) && imsToken && env.DACOLLAB
      ? await createCollabClient(sourceUrl, imsToken, pageContext.org, env.DACOLLAB)
      : null;

  const adminClient =
    imsToken && env.DAADMIN
      ? new DAAdminClient({ apiToken: imsToken, daadminService: env.DAADMIN })
      : null;

  const edsClient = imsToken ? new EDSAdminClient({ apiToken: imsToken }) : null;

  const projectMemory =
    adminClient && pageContext
      ? await fetchProjectMemory(adminClient, pageContext.org, pageContext.site)
      : null;

  return {
    pageContext,
    imsToken,
    daOrigin,
    sourceUrl,
    adminClient,
    edsClient,
    collab,
    attachmentMap,
    attachments,
    projectMemory,
  };
}
