import { describe, it, expect, vi, afterEach } from 'vitest';
import { DAAdminClient } from '../../src/da-admin/client';

function makeClient(response: Response) {
  return new DAAdminClient({
    apiToken: 'test-token',
    daadminService: { fetch: vi.fn().mockResolvedValue(response) } as unknown as Fetcher,
  });
}

describe('DAAdminClient logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log successful calls', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await client.listSources('org', 'repo');

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a failed call once with method, endpoint and status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = makeClient(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(client.listSources('org', 'repo')).rejects.toMatchObject({ status: 404 });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(
      /^DA Admin API Error: GET \/list\/org\/repo 404 Not Found \(\d+ms\)$/,
    );
    expect(error).not.toHaveBeenCalled();
  });
});
