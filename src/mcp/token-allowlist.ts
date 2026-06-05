/**
 * Domain allowlist for IMS token forwarding to MCP servers.
 *
 * Prevents user-configured MCP servers from receiving bearer tokens
 * unless their URL matches a trusted domain pattern.
 */

const DEFAULT_TRUSTED_PATTERNS = ['*.adobe.io'];

/**
 * Parse a comma-separated list of domain patterns into an array.
 * Patterns support leading wildcard: `*.example.com` matches `foo.example.com`.
 * Unset env var → defaults. Explicitly empty → empty (trust nothing).
 */
export function parseTrustedDomains(envValue?: string): string[] {
  if (envValue === undefined || envValue === null) return DEFAULT_TRUSTED_PATTERNS;
  const parsed = envValue
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parsed;
}

/**
 * Check whether a URL's hostname matches any pattern in the allowlist.
 * Patterns:
 *   - `*.example.com` → matches example.com and any subdomain (foo.example.com)
 *   - `example.com` → exact hostname match
 */
export function isUrlTrustedForToken(url: string, trustedPatterns: string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  for (const pattern of trustedPatterns) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. ".adobe.io"
      if (hostname.endsWith(suffix) || hostname === pattern.slice(2)) {
        return true;
      }
    } else if (hostname === pattern) {
      return true;
    }
  }
  return false;
}
