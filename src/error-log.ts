const MAX_FIELD_LENGTH = 2000;
const MAX_CAUSE_DEPTH = 6;

function truncate(value: string): string {
  return value.length > MAX_FIELD_LENGTH
    ? `${value.slice(0, MAX_FIELD_LENGTH)}… (${value.length} chars)`
    : value;
}

/**
 * Unwraps the `{ error }` event passed to `streamText`'s `onError` callback.
 */
export function unwrapErrorEvent(event: unknown): unknown {
  if (event && typeof event === 'object' && !(event instanceof Error) && 'error' in event) {
    return (event as { error: unknown }).error;
  }
  return event;
}

/**
 * Formats streamText / provider errors for logging. Keeps the diagnostic fields of AI SDK
 * API errors (status, URL, response body) but never the request body, which contains the
 * full system prompt and conversation.
 */
export function formatErrorForLog(event: unknown): string {
  const err = unwrapErrorEvent(event);
  if (err instanceof Error) {
    const api = err as Error & {
      statusCode?: number;
      url?: string;
      isRetryable?: boolean;
      responseBody?: string;
    };
    const lines = [`${err.name}: ${err.message}`];
    if (api.statusCode !== undefined) lines.push(`status: ${api.statusCode}`);
    if (api.url) lines.push(`url: ${api.url}`);
    if (api.isRetryable !== undefined) lines.push(`retryable: ${api.isRetryable}`);
    if (api.responseBody) lines.push(`response: ${truncate(api.responseBody)}`);
    if (err.stack) lines.push(err.stack);
    let c: unknown = err.cause;
    let depth = 0;
    while (c instanceof Error && depth < MAX_CAUSE_DEPTH) {
      lines.push(`Caused by: ${c.name}: ${c.message}`);
      c = c.cause;
      depth += 1;
    }
    return lines.join('\n');
  }
  if (err && typeof err === 'object') {
    try {
      return truncate(
        JSON.stringify(err, (key, value) => (key === 'requestBodyValues' ? undefined : value)),
      );
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}
