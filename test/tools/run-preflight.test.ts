import { describe, it, expect } from 'vitest';
import { createDATools } from '../../src/tools/tools.js';
import type { DAAdminClient } from '../../src/da-admin/client.js';

function mockClient(): DAAdminClient {
  return { getSiteConfig: async () => ({}) } as unknown as DAAdminClient;
}

function getPreflightTool() {
  const tools = createDATools(mockClient(), { org: 'org', repo: 'site' });
  return tools.run_preflight;
}

// ─── tool exists and is wired ──────────────────────────────────────────────

describe('run_preflight tool definition', () => {
  it('is registered in the tools registry', () => {
    expect(getPreflightTool()).toBeDefined();
  });

  it('requires user approval', async () => {
    const tool = getPreflightTool();
    const needs = await tool.needsApproval?.({});
    expect(needs).toBe(true);
  });

  it('execute returns approved: true', async () => {
    const tool = getPreflightTool();
    const result = await tool.execute({
      title: 'Test Page',
      readiness: 90,
      categories: [],
    });
    expect(result).toEqual({ approved: true });
  });
});

// ─── input schema validation ───────────────────────────────────────────────

describe('run_preflight input schema', () => {
  it('accepts a valid full payload', () => {
    const { inputSchema } = getPreflightTool();
    const result = inputSchema.safeParse({
      title: 'Cold Coffee Campaign',
      readiness: 94,
      categories: [
        {
          name: 'Context',
          checks: [
            { label: 'Tone of voice', passed: true },
            { label: 'Logo Usage', passed: false },
          ],
        },
      ],
      summary: '94% readiness.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts payload without optional summary', () => {
    const { inputSchema } = getPreflightTool();
    const result = inputSchema.safeParse({
      title: 'No Summary Page',
      readiness: 75,
      categories: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects readiness above 100', () => {
    const { inputSchema } = getPreflightTool();
    expect(inputSchema.safeParse({ title: 'Over', readiness: 101, categories: [] }).success).toBe(
      false,
    );
  });

  it('rejects readiness below 0', () => {
    const { inputSchema } = getPreflightTool();
    expect(inputSchema.safeParse({ title: 'Under', readiness: -1, categories: [] }).success).toBe(
      false,
    );
  });

  it('rejects non-integer readiness', () => {
    const { inputSchema } = getPreflightTool();
    expect(inputSchema.safeParse({ title: 'Float', readiness: 94.5, categories: [] }).success).toBe(
      false,
    );
  });

  it('rejects missing required title', () => {
    const { inputSchema } = getPreflightTool();
    expect(inputSchema.safeParse({ readiness: 80, categories: [] }).success).toBe(false);
  });

  it('rejects a check missing the passed field', () => {
    const { inputSchema } = getPreflightTool();
    const result = inputSchema.safeParse({
      title: 'Bad Check',
      readiness: 50,
      categories: [{ name: 'SEO', checks: [{ label: 'Title' }] }],
    });
    expect(result.success).toBe(false);
  });
});
