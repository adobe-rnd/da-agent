import { describe, it, expect } from 'vitest';
import { createDATools } from '../../src/tools/tools.js';
import { loadSkillsIndex } from '../../src/skills/loader.js';
import type { DAAdminClient } from '../../src/da-admin/client.js';

/**
 * Regression test for the save->read contradiction: `da_create_skill` used to
 * persist skills as `status: 'draft'`, but every read/list path (the legacy
 * config-sheet fallback AND the folder-first index) excludes draft rows - so
 * a skill the agent just "saved" for the user was immediately unreadable by
 * `da_read_skill` and absent from the skills index the moment the chat
 * session ended (see bug-skills/ISSUE-da-create-skill-draft-regression.md).
 *
 * This exercises the REAL `da_create_skill`/`da_read_skill` tools (not a
 * re-implementation), so it fails against the pre-fix `status: 'draft'` save
 * and passes once `da_create_skill` saves `status: 'approved'`.
 */
function makeStatefulDAClient(): DAAdminClient {
  // In-memory site config, shared across getSiteConfig/saveSiteConfig calls -
  // the thing the stateless mocks elsewhere in this repo deliberately don't do.
  let siteConfig: Record<string, unknown> = {};

  return {
    getSiteConfig: async () => siteConfig,
    saveSiteConfig: async (_org: string, _site: string, cfg: Record<string, unknown>) => {
      siteConfig = cfg;
      return { ok: true };
    },
    // No `.da/skills/` folder yet (new site) - loadSkillBodyFromFolder must
    // fall through to the legacy sheet, same as in the reported bug.
    getSource: async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    },
    listSources: async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    },
  } as unknown as DAAdminClient;
}

describe('da_create_skill -> da_read_skill round trip (regression)', () => {
  it('a skill saved via da_create_skill is immediately readable via da_read_skill', async () => {
    const client = makeStatefulDAClient();
    const tools = createDATools(client, { org: 'myorg', repo: 'mysite' });

    const createResult = await tools.da_create_skill.execute(
      {
        skillId: 'frescopa-page-variations',
        content: '# Page Variations\n\nGenerate FR/B2B variants.',
      },
      {} as any,
    );
    expect(createResult).toEqual({ skillId: 'frescopa-page-variations', saved: true });

    const readResult = await tools.da_read_skill.execute(
      { skillId: 'frescopa-page-variations' },
      {} as any,
    );

    // Pre-fix (status: 'draft'), this was `{ error: 'Skill "frescopa-page-variations" not found' }`
    // - the exact bug reported: create succeeds, immediate read fails.
    expect(readResult.error).toBeUndefined();
    expect(readResult.content).toBe('# Page Variations\n\nGenerate FR/B2B variants.');
  });

  it('a skill saved via da_create_skill appears in the skills index after the chat session ends', async () => {
    const client = makeStatefulDAClient();
    const tools = createDATools(client, { org: 'myorg', repo: 'mysite' });

    await tools.da_create_skill.execute(
      {
        skillId: 'frescopa-page-variations',
        content: '# Page Variations\n\nGenerate FR/B2B variants.',
      },
      {} as any,
    );

    // Simulates a fresh session reloading the index (no folder, no per-session
    // state - just the shared site config the save call above wrote to).
    const index = await loadSkillsIndex(client, 'myorg', 'mysite');

    expect(index.skills.map((s) => s.id)).toContain('frescopa-page-variations');
  });
});
