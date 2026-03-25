/**
 * DA Tools
 * Vercel AI SDK tool definitions wrapping DAAdminClient
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { DAAdminClient } from '../da-admin/client';
import type { DAAPIError } from '../da-admin/types';
import type { CollabClient } from '../collab-client';
import { ensureHtmlExtension } from './utils';
import {
  ReplaceTextSchema,
  InsertElementSchema,
  DeleteElementSchema,
  ReplaceElementSchema,
  UpdateAttributeSchema,
} from './operations.js';

function isDAAPIError(e: unknown): e is DAAPIError {
  return typeof e === 'object' && e !== null && 'status' in e && 'message' in e;
}

export type PageContext = {
  org: string;
  site: string;
  path: string;
  view?: string;
};

export type DAToolsOptions = {
  pageContext?: PageContext;
  collab?: CollabClient | null;
};

export function createDATools(client: DAAdminClient, options?: DAToolsOptions) {
  const opts = options;
  return {
    da_list_sources: tool({
      description:
        'List all sources and directories in a DA repository at a given path. Returns a list of files and folders with their metadata.',
      inputSchema: z.object({
        org: z.string().describe('Organization name (e.g., "adobe")'),
        repo: z.string().describe('Repository name (e.g., "my-docs")'),
        path: z
          .string()
          .optional()
          .describe(
            'Optional path within repository (e.g., "docs/guides"). Leave empty for root.',
          ),
      }),
      execute: async ({ org, repo, path }) => {
        try {
          return await client.listSources(org, repo, path);
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_create_source: tool({
      description:
        'Create a new source file in a DA repository with the specified content. '
        + 'Content MUST be a plain HTML string (no CDATA, no markdown fences) starting with <body> and ending with </body>, '
        + 'with all page content wrapped in <main> inside <body>. '
        + 'Separate sections with <hr>, represent EDS blocks as <div class="block-name"> elements where each '
        + 'content row is a child <div> and each column a nested <div>, use proper semantic HTML elements '
        + '(headings, p, ul/ol/li, a, img with alt), and never use inline styles or <table> tags for blocks.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z
          .string()
          .describe(
            'Path where the new file should be created (e.g., "docs/new-page.md")',
          ),
        content: z.string().describe('Content of the new file'),
        contentType: z
          .string()
          .optional()
          .describe(
            'Optional content type (e.g., "text/markdown", "text/html")',
          ),
      }),
      needsApproval: async () => false,
      execute: async ({
        org, repo, path, content, contentType,
      }) => {
        try {
          return await client.createSource(
            org,
            repo,
            ensureHtmlExtension(path),
            content,
            contentType,
          );
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_delete_source: tool({
      description:
        'Delete a source file from a DA repository. Use with caution as this operation cannot be undone.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file to delete'),
      }),
      needsApproval: async () => false,
      execute: async ({ org, repo, path }) => {
        try {
          return await client.deleteSource(org, repo, ensureHtmlExtension(path));
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_copy_content: tool({
      description:
        'Copy content from one location to another within a DA repository. Creates a duplicate of the source at the destination.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        sourcePath: z.string().describe('Path to the source file to copy from'),
        destinationPath: z
          .string()
          .describe('Path where the file should be copied to'),
      }),
      execute: async ({
        org, repo, sourcePath, destinationPath,
      }) => {
        try {
          return await client.copyContent(
            org,
            repo,
            ensureHtmlExtension(sourcePath),
            ensureHtmlExtension(destinationPath),
          );
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_move_content: tool({
      description:
        'Move content from one location to another within a DA repository. The source file will be removed.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        sourcePath: z.string().describe('Path to the source file to move from'),
        destinationPath: z
          .string()
          .describe('Path where the file should be moved to'),
      }),
      needsApproval: async () => false,
      execute: async ({
        org, repo, sourcePath, destinationPath,
      }) => {
        try {
          return await client.moveContent(
            org,
            repo,
            ensureHtmlExtension(sourcePath),
            ensureHtmlExtension(destinationPath),
          );
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_create_version: tool({
      description:
        'Create a version of a source document or sheet in a DA repository. Use this to snapshot the current state of a file before making changes.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z
          .string()
          .describe(
            'Path to the file including extension (e.g., "docs/my-page.html")',
          ),
        label: z.string().optional().describe('Optional label for the version'),
      }),
      execute: async ({
        org, repo, path, label,
      }) => {
        try {
          return await client.createVersion(org, repo, ensureHtmlExtension(path), label);
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_get_versions: tool({
      description:
        'Get version history for a source file in a DA repository. Returns a list of versions with timestamps and metadata.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
      }),
      execute: async ({ org, repo, path }) => {
        try {
          return await client.getVersions(org, repo, ensureHtmlExtension(path));
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_lookup_media: tool({
      description:
        'Lookup media references in a DA repository. Returns information about media assets including URLs and metadata.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        mediaPath: z.string().describe('Path to the media file'),
      }),
      execute: async ({ org, repo, mediaPath }) => {
        try {
          return await client.lookupMedia(org, repo, mediaPath);
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_lookup_fragment: tool({
      description:
        'Lookup fragment references in a DA repository. Returns information about content fragments.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        fragmentPath: z.string().describe('Path to the fragment'),
      }),
      execute: async ({ org, repo, fragmentPath }) => {
        try {
          return await client.lookupFragment(org, repo, fragmentPath);
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_read_content: tool({
      description: 'Read the current HTML content of the page open in the editor. '
        + 'Always call this first in edit view to understand the document structure before making any changes.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
      }),
      needsApproval: async () => false,
      execute: async ({ path }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{ type: 'read_content' }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_read_content requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_replace_text: tool({
      description: 'Find a text string in the document and replace it with new text. '
        + 'Moves the AI cursor to the target location and simulates character-by-character typing '
        + 'so collaborators can follow along in real time. '
        + 'Use nth to target a specific occurrence when the text appears multiple times.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
        ...ReplaceTextSchema.omit({ type: true }).shape,
      }),
      needsApproval: async () => false,
      execute: async ({
        path, find, replace, nth,
      }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{
              type: 'replace_text', find, replace, nth,
            }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_replace_text requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_insert_element: tool({
      description: 'Insert a new HTML element (paragraph, heading, block, list, etc.) before or after an anchor element. '
        + 'anchor is a distinctive substring of the neighbouring element\'s text. '
        + 'anchorType narrows the match by CSS selector (e.g. "h2", "p", "div.hero"). '
        + 'anchorIndex (1-based) selects which matching element when several match.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
        ...InsertElementSchema.omit({ type: true }).shape,
      }),
      needsApproval: async () => false,
      execute: async ({
        path, anchor, insertPosition, html, anchorType, anchorIndex,
      }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{
              type: 'insert_element', anchor, insertPosition, html, anchorType, anchorIndex,
            }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_insert_element requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_delete_element: tool({
      description: 'Delete an element (paragraph, heading, block, etc.) identified by its text content. '
        + 'anchor is a distinctive substring of the element to remove. '
        + 'anchorType narrows the match by CSS selector. '
        + 'anchorIndex (1-based) selects which occurrence when several match.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
        ...DeleteElementSchema.omit({ type: true }).shape,
      }),
      needsApproval: async () => false,
      execute: async ({
        path, anchor, anchorType, anchorIndex,
      }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{
              type: 'delete_element', anchor, anchorType, anchorIndex,
            }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_delete_element requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_replace_element: tool({
      description: 'Replace an entire element with new HTML. '
        + 'anchor is a distinctive substring of the element to replace. '
        + 'anchorType narrows the match by CSS selector. '
        + 'anchorIndex (1-based) selects which occurrence when several match.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
        ...ReplaceElementSchema.omit({ type: true }).shape,
      }),
      needsApproval: async () => false,
      execute: async ({
        path, anchor, html, anchorType, anchorIndex,
      }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{
              type: 'replace_element', anchor, html, anchorType, anchorIndex,
            }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_replace_element requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_update_attribute: tool({
      description: 'Set or update an HTML attribute on an element (e.g. href, src, alt, class). '
        + 'anchor is a distinctive substring of the target element\'s text or attribute value. '
        + 'anchorType narrows the match by CSS selector (e.g. "a", "img"). '
        + 'anchorIndex (1-based) selects which occurrence when several match.',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z.string().describe('Path to the file'),
        ...UpdateAttributeSchema.omit({ type: true }).shape,
      }),
      needsApproval: async () => false,
      execute: async ({
        path, anchor, attribute, value, anchorType, anchorIndex,
      }) => {
        const pathWithExt = ensureHtmlExtension(path);
        try {
          if (opts?.collab?.isConnected) {
            const results = await opts.collab.applyOperations([{
              type: 'update_attribute', anchor, attribute, value, anchorType, anchorIndex,
            }]);
            return { path: pathWithExt, source: 'collab', results };
          }
          return { error: 'da_update_attribute requires an active collab session (edit view only).' };
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),

    da_upload_media: tool({
      description:
        'Upload an image or media file to a DA repository using base64-encoded data. '
        + 'When uploading images referenced in a page (e.g. during page creation or update), '
        + 'place the image in a child folder named after the page, sibling to the page file '
        + '(e.g. page at "docs/my-page.html" → image at "docs/.my-page/image.png" with the folder name with a leading dot). '
        + 'For standalone media uploads unrelated to a specific page, use the "media" folder '
        + '(e.g. "media/image.png").',
      inputSchema: z.object({
        org: z.string().describe('Organization name'),
        repo: z.string().describe('Repository name'),
        path: z
          .string()
          .describe(
            'Destination path for the media file. '
              + 'For page-related images use a dot-prefixed folder named after the page: "docs/.my-page/image.png". '
              + 'For standalone uploads use the media folder: "media/image.png".',
          ),
        base64Data: z.string().describe('Base64-encoded file content'),
        mimeType: z
          .string()
          .describe('MIME type of the file (e.g., "image/png", "image/jpeg")'),
        fileName: z
          .string()
          .describe('Original filename including extension (e.g., "photo.jpg")'),
      }),
      execute: async ({
        org, repo, path, base64Data, mimeType, fileName,
      }) => {
        try {
          return await client.uploadMedia(
            org,
            repo,
            path,
            base64Data,
            mimeType,
            fileName,
          );
        } catch (e) {
          if (isDAAPIError(e)) return { error: e.message, status: e.status };
          return { error: String(e) };
        }
      },
    }),
  };
}
