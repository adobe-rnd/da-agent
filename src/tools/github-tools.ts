/**
 * GitHub Tools — create repos and push files via the GitHub REST API.
 * Used by the "Build Apps on the Fly" workflow to deploy generated
 * Astro fragment apps to Cloudflare Pages via GitHub.
 */

import { tool } from 'ai';
import { z } from 'zod';

const GITHUB_API = 'https://api.github.com';

async function ghFetch(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
}

export function createGitHubTools(githubToken: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  tools.github_create_repo = tool({
    description:
      'Create a new GitHub repository. Use this as the first step when deploying a ' +
      'generated web app (e.g., an Astro fragment app for Web Fragments). ' +
      'The repo can then be connected to Cloudflare Pages for automatic deployment.',
    inputSchema: z.object({
      name: z.string().describe('Repository name (e.g., "aem-restaurant-booking")'),
      description: z.string().optional().describe('Short repo description'),
      isPrivate: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether the repo should be private'),
      org: z
        .string()
        .optional()
        .describe('GitHub org to create the repo under (omit for user repo)'),
    }),
    needsApproval: async () => true,
    execute: async ({ name, description, isPrivate, org }) => {
      try {
        const endpoint = org ? `/orgs/${org}/repos` : '/user/repos';
        const res = await ghFetch(endpoint, githubToken, {
          method: 'POST',
          body: JSON.stringify({
            name,
            description: description ?? '',
            private: isPrivate ?? false,
            auto_init: true,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          return { error: `GitHub API ${res.status}: ${body}` };
        }
        const repo = (await res.json()) as {
          full_name: string;
          html_url: string;
          clone_url: string;
        };
        return {
          fullName: repo.full_name,
          url: repo.html_url,
          cloneUrl: repo.clone_url,
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
  });

  tools.github_push_files = tool({
    description:
      'Push multiple files to a GitHub repository in a single commit. ' +
      'Use this after github_create_repo to push generated app code. ' +
      'Each file is specified as a path + content pair. ' +
      'This creates a new commit on the default branch with all files at once.',
    inputSchema: z.object({
      owner: z.string().describe('Repository owner (user or org)'),
      repo: z.string().describe('Repository name'),
      files: z
        .array(
          z.object({
            path: z
              .string()
              .describe('File path relative to repo root (e.g., "src/pages/index.astro")'),
            content: z.string().describe('File content as a UTF-8 string'),
          }),
        )
        .min(1)
        .describe('Files to push'),
      message: z
        .string()
        .optional()
        .default('feat: initial app scaffold')
        .describe('Commit message'),
      branch: z.string().optional().default('main').describe('Branch to push to'),
    }),
    needsApproval: async () => true,
    execute: async ({ owner, repo, files, message, branch }) => {
      try {
        // 1. Get the latest commit SHA on the branch
        const refRes = await ghFetch(
          `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
          githubToken,
        );
        if (!refRes.ok) {
          return { error: `Could not get branch ref: ${await refRes.text()}` };
        }
        const refData = (await refRes.json()) as { object: { sha: string } };
        const latestCommitSha = refData.object.sha;

        // 2. Get the tree SHA of the latest commit
        const commitRes = await ghFetch(
          `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
          githubToken,
        );
        const commitData = (await commitRes.json()) as { tree: { sha: string } };
        const baseTreeSha = commitData.tree.sha;

        // 3. Create blobs for each file
        const treeItems = await Promise.all(
          files.map(async (file) => {
            const blobRes = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, githubToken, {
              method: 'POST',
              body: JSON.stringify({
                content: file.content,
                encoding: 'utf-8',
              }),
            });
            const blob = (await blobRes.json()) as { sha: string };
            return {
              path: file.path,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: blob.sha,
            };
          }),
        );

        // 4. Create a new tree
        const treeRes = await ghFetch(`/repos/${owner}/${repo}/git/trees`, githubToken, {
          method: 'POST',
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeItems,
          }),
        });
        const treeData = (await treeRes.json()) as { sha: string };

        // 5. Create a new commit
        const newCommitRes = await ghFetch(`/repos/${owner}/${repo}/git/commits`, githubToken, {
          method: 'POST',
          body: JSON.stringify({
            message: message ?? 'feat: initial app scaffold',
            tree: treeData.sha,
            parents: [latestCommitSha],
          }),
        });
        const newCommit = (await newCommitRes.json()) as { sha: string; html_url: string };

        // 6. Update the branch reference
        await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, githubToken, {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha }),
        });

        return {
          commitSha: newCommit.sha,
          commitUrl: newCommit.html_url,
          filesCount: files.length,
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
  });

  return tools;
}
