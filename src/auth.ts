export const DA_OAUTH_CLIENT_ID = 'darkalley';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Extract user_id or sub claim from an IMS JWT token WITHOUT verifying
 * the signature. Use only for non-security purposes (telemetry, logging).
 * Never use this for authorization decisions.
 */
export function extractImsUserId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.user_id ?? decoded.sub ?? undefined;
  } catch {
    return undefined;
  }
}
