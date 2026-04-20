/**
 * Cloudflare Tools — create Pages projects and poll deployment status
 * via the Cloudflare REST API. Used by the "Build Apps on the Fly"
 * workflow to deploy generated Astro fragment apps.
 */

import { tool } from 'ai';
import { z } from 'zod';

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cfFetch(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
}

export function createCloudflareTools(cfApiToken: string, cfAccountId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  tools.cf_create_pages_project = tool({
    description:
      'Create a new Cloudflare Pages project connected to a GitHub repository. ' +
      'After the GitHub repo has been created and code pushed, use this to set up ' +
      'automatic deployments from the repo. The project will build with the ' +
      'specified build command and publish the output directory.',
    inputSchema: z.object({
      projectName: z
        .string()
        .describe(
          'Pages project name (e.g., "aem-restaurant-booking"). Must be unique within the account.',
        ),
      githubOwner: z.string().describe('GitHub repository owner (user or org)'),
      githubRepo: z.string().describe('GitHub repository name'),
      productionBranch: z.string().optional().default('main').describe('Branch to deploy from'),
      buildCommand: z
        .string()
        .optional()
        .default('npm run build')
        .describe('Build command (e.g., "npm run build")'),
      buildOutputDir: z
        .string()
        .optional()
        .default('dist')
        .describe('Build output directory (e.g., "dist" for Astro)'),
      environmentVariables: z
        .record(z.string(), z.string())
        .optional()
        .describe('Environment variables for the build'),
    }),
    needsApproval: async () => true,
    execute: async ({
      projectName,
      githubOwner,
      githubRepo,
      productionBranch,
      buildCommand,
      buildOutputDir,
      environmentVariables,
    }) => {
      try {
        const envVars: Record<string, { value: string }> = {};
        if (environmentVariables) {
          for (const [k, v] of Object.entries(environmentVariables)) {
            envVars[k] = { value: v };
          }
        }

        const res = await cfFetch(`/accounts/${cfAccountId}/pages/projects`, cfApiToken, {
          method: 'POST',
          body: JSON.stringify({
            name: projectName,
            production_branch: productionBranch ?? 'main',
            source: {
              type: 'github',
              config: {
                owner: githubOwner,
                repo_name: githubRepo,
                production_branch: productionBranch ?? 'main',
                deployments_enabled: true,
              },
            },
            build_config: {
              build_command: buildCommand ?? 'npm run build',
              destination_dir: buildOutputDir ?? 'dist',
            },
            deployment_configs: {
              production: {
                environment_variables: envVars,
              },
            },
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          return { error: `Cloudflare API ${res.status}: ${body}` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as { result: any };
        const project = data.result;

        return {
          projectName: project.name,
          subdomain: project.subdomain,
          url: `https://${project.subdomain}`,
          productionBranch: project.production_branch,
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
  });

  tools.cf_get_deploy_status = tool({
    description:
      'Check the latest deployment status for a Cloudflare Pages project. ' +
      'Use this to poll whether a deployment triggered by a GitHub push has completed. ' +
      'Returns the deployment stage, URL, and any error information.',
    inputSchema: z.object({
      projectName: z.string().describe('Pages project name'),
    }),
    execute: async ({ projectName }) => {
      try {
        const res = await cfFetch(
          `/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
          cfApiToken,
        );

        if (!res.ok) {
          const body = await res.text();
          return { error: `Cloudflare API ${res.status}: ${body}` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as { result: any[] };
        const deployments = data.result;

        if (!deployments || deployments.length === 0) {
          return { status: 'no_deployments', message: 'No deployments found yet.' };
        }

        const latest = deployments[0];
        return {
          id: latest.id,
          status: latest.latest_stage?.name ?? 'unknown',
          stageStatus: latest.latest_stage?.status ?? 'unknown',
          url: latest.url,
          environment: latest.environment,
          createdOn: latest.created_on,
          source: latest.source?.type ?? 'unknown',
          isActive: latest.latest_stage?.status === 'success',
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
  });

  return tools;
}
