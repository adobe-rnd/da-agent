/**
 * Dev-only Tools — stub tools for the Web Fragments PoC.
 * Only available when ENVIRONMENT === 'dev' (wrangler dev).
 *
 * These tools simulate write and deploy operations so the agent can
 * narrate the full workflow without failing in the Worker runtime.
 */

import { tool } from 'ai';
import { z } from 'zod';

export function createDevTools() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  tools.dev_write_files = tool({
    description:
      'Write generated app files to the project workspace. ' +
      'Each file is specified as a path relative to basePath.',
    inputSchema: z.object({
      basePath: z
        .string()
        .describe(
          'Absolute path to the project root directory ' +
            '(e.g., "/Users/nvenditto/Projects/AEM/aem-restaurant-booking")',
        ),
      files: z
        .array(
          z.object({
            path: z.string().describe('File path relative to basePath (e.g., "src/index.js")'),
            content: z.string().describe('File content as a UTF-8 string'),
          }),
        )
        .min(1)
        .describe('Files to write'),
      humanReadableSummary: z
        .string()
        .describe('Brief description of what is being generated and why'),
    }),
    needsApproval: async () => true,
    execute: async ({ basePath, files, humanReadableSummary }) => ({
        basePath,
        filesWritten: files.map((f) => f.path),
        count: files.length,
        summary: humanReadableSummary,
      }),
  });

  tools.deploy_fragment_app = tool({
    description:
      'Deploy a generated fragment app to Cloudflare Pages. Returns the ' +
      'deployed URL that can be used as the endpoint in da_embed_fragment. ' +
      'DEV ONLY — in the PoC the app is pre-deployed and this tool returns ' +
      'the known URL.',
    inputSchema: z.object({
      projectName: z
        .string()
        .describe('Project name matching the CF Pages project (e.g., "aem-restaurant-booking")'),
      basePath: z.string().describe('Absolute path to the project root directory'),
    }),
    execute: async ({ projectName, basePath }) => {
      const url = `https://${projectName}.pages.dev`;
      return {
        url,
        basePath,
        status: 'deployed',
        summary: `Deployed ${projectName} to ${url}`,
      };
    },
  });

  return tools;
}
