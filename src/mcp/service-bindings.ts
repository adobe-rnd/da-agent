/**
 * Service-binding routing for MCP servers that live on the same Cloudflare
 * account as da-agent.
 *
 * Cloudflare does not route worker-to-worker subrequests between two
 * `*.workers.dev` hostnames on the same account. For those targets we must call the
 * worker through a configured service binding (`env.<BINDING>.fetch(...)`)
 * instead of the global `fetch`.
 *
 * Each entry maps the host(s) a user may configure to the env binding that
 * points at the corresponding worker. The binding is per-environment in
 * wrangler.toml, so the same logical binding resolves to the CI worker in CI
 * and the production worker in production.
 * TODO: This is temporary and for experimental purposes. We need to find
 * a better solution to allow da-agent to talk to other Adobe workers.
 */

interface ServiceBindingRoute {
  /** Host matcher for URLs that should be routed through `binding`. */
  matches: (hostname: string) => boolean;
  /** Key on `env` holding the Fetcher service binding. */
  binding: keyof Env;
}

const ROUTES: ServiceBindingRoute[] = [
  {
    // aem-agentic-plugins (prod) and aem-agentic-plugins-ci (CI), both on the
    // shared adobeaem.workers.dev account.
    matches: (h) =>
      h === 'aem-agentic-plugins.adobeaem.workers.dev' ||
      h === 'aem-agentic-plugins-ci.adobeaem.workers.dev',
    binding: 'AEM_AGENTIC_PLUGINS',
  },
];

/**
 * Resolve the service-binding Fetcher to use for a given MCP server URL, or
 * `undefined` to fall back to the global `fetch`.
 *
 * Returns `undefined` when the URL is unparseable, the host has no configured
 * route, or the matching binding is not present on `env`.
 */
export function resolveMcpFetcher(url: string, env: Env): Fetcher | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }

  for (const route of ROUTES) {
    if (route.matches(hostname)) {
      const fetcher = env[route.binding] as Fetcher | undefined;
      return fetcher ?? undefined;
    }
  }
  return undefined;
}
