import { describe, it, expect } from 'vitest';
import { APICallError } from 'ai';
import { formatErrorForLog, unwrapErrorEvent } from '../src/error-log';

function apiError(responseBody?: string) {
  return new APICallError({
    message: 'messages.1: tool_use ids were found without tool_result blocks',
    url: 'https://bedrock.example/invoke',
    requestBodyValues: { system: 'SECRET SYSTEM PROMPT', messages: [{ content: 'user text' }] },
    statusCode: 400,
    responseBody,
    isRetryable: false,
  });
}

describe('formatErrorForLog', () => {
  it('unwraps the streamText onError event and omits the request body', () => {
    const output = formatErrorForLog({ error: apiError('{"message":"bad request"}') });

    expect(output).toMatch(/^AI_APICallError: messages\.1: tool_use ids/);
    expect(output).toContain('status: 400');
    expect(output).toContain('url: https://bedrock.example/invoke');
    expect(output).toContain('retryable: false');
    expect(output).toContain('response: {"message":"bad request"}');
    expect(output).not.toContain('SECRET SYSTEM PROMPT');
    expect(output).not.toContain('user text');
  });

  it('truncates large response bodies', () => {
    const output = formatErrorForLog(apiError('x'.repeat(5000)));

    expect(output).toContain('… (5000 chars)');
    expect(output).not.toContain('x'.repeat(2001));
  });

  it('drops requestBodyValues from non-Error objects', () => {
    const output = formatErrorForLog({
      error: { name: 'X', requestBodyValues: { system: 'SECRET' } },
    });

    expect(output).toBe('{"name":"X"}');
  });

  it('keeps the cause chain', () => {
    const err = new Error('outer', { cause: new TypeError('inner') });

    expect(formatErrorForLog(err)).toContain('Caused by: TypeError: inner');
  });
});

describe('unwrapErrorEvent', () => {
  it('returns the error from an event, and errors unchanged', () => {
    const err = new Error('boom');

    expect(unwrapErrorEvent({ error: err })).toBe(err);
    expect(unwrapErrorEvent(err)).toBe(err);
  });
});
