import { describe, it, expect } from 'vitest';
import {
  loadSkillsIndexFromFolders,
  loadSkillBodyFromFolder,
  LEGACY_SKILLS_SHEET_FALLBACK_ENABLED,
} from '../../src/skills/folder-loader.js';
import type { DAAdminClient } from '../../src/da-admin/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_MD = (name: string, description: string, version = 1, status = 'approved') =>
  `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\nstatus: ${status}\n---\n# ${name}\n\nBody text for ${name}.`;

const BODY_ONLY = (name: string) => `# ${name}\n\nBody text for ${name}.`;

type ClientOpts = {
  listResponse?: unknown;
  listError?: { status: number };
  /** path → raw response (string for .md, object for JSON) */
  sourceByPath?: Record<string, unknown>;
  /** config sheet skills data for legacy fallback */
  configSkills?: { key: string; content: string; status?: string }[];
};

function mockClient(opts: ClientOpts = {}): DAAdminClient {
  return {
    listSources: async (_org: string, _site: string, _path: string) => {
      if (opts.listError) throw opts.listError;
      return opts.listResponse ?? [];
    },
    getSource: async (_org: string, _site: string, path: string) => {
      const val = opts.sourceByPath?.[path];
      if (val === undefined) {
        const err = Object.assign(new Error('not found'), { status: 404 });
        throw err;
      }
      return val as ReturnType<DAAdminClient['getSource']>;
    },
    getSiteConfig: async () => {
      if (!opts.configSkills) throw Object.assign(new Error('not found'), { status: 404 });
      return {
        skills: {
          data: opts.configSkills,
          total: opts.configSkills.length,
        },
      };
    },
  } as unknown as DAAdminClient;
}

// ---------------------------------------------------------------------------
// loadSkillsIndexFromFolders
// ---------------------------------------------------------------------------

describe('loadSkillsIndexFromFolders', () => {
  it('builds index from folder-layout skills', async () => {
    const client = mockClient({
      listResponse: [
        { name: 'brand-voice', path: '/.da/skills/brand-voice' },
        { name: 'seo-checklist', path: '/.da/skills/seo-checklist' },
      ],
      sourceByPath: {
        '.da/skills/brand-voice/skill.md': SKILL_MD('brand-voice', 'Enforce brand tone guidelines'),
        '.da/skills/seo-checklist/skill.md': SKILL_MD(
          'seo-checklist',
          'Run SEO checks before publish',
        ),
      },
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.source).toBe('folder');
    expect(index.skills).toHaveLength(2);
    expect(index.skills[0]).toEqual({ id: 'brand-voice', title: 'Enforce brand tone guidelines' });
    expect(index.skills[1]).toEqual({
      id: 'seo-checklist',
      title: 'Run SEO checks before publish',
    });
  });

  it('excludes draft skills from the index', async () => {
    const client = mockClient({
      listResponse: [
        { name: 'live-skill', path: '/.da/skills/live-skill' },
        { name: 'wip-skill', path: '/.da/skills/wip-skill' },
      ],
      sourceByPath: {
        '.da/skills/live-skill/skill.md': SKILL_MD('live-skill', 'Live description', 1, 'approved'),
        '.da/skills/wip-skill/skill.md': SKILL_MD('wip-skill', 'WIP description', 1, 'draft'),
      },
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0]?.id).toBe('live-skill');
  });

  it('skips folder entries without a readable skill.md', async () => {
    const client = mockClient({
      listResponse: [
        { name: 'good-skill', path: '/.da/skills/good-skill' },
        { name: 'broken-skill', path: '/.da/skills/broken-skill' },
      ],
      sourceByPath: {
        '.da/skills/good-skill/skill.md': SKILL_MD('good-skill', 'Good skill', 1),
        // broken-skill/skill.md is missing → throws 404
      },
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0]?.id).toBe('good-skill');
  });

  it('ignores folder entries with an ext (they are files, not folders)', async () => {
    const client = mockClient({
      listResponse: [
        { name: 'valid-skill', path: '/.da/skills/valid-skill' },
        { name: 'some-file', ext: '.json', path: '/.da/skills/some-file.json' },
      ],
      sourceByPath: {
        '.da/skills/valid-skill/skill.md': SKILL_MD('valid-skill', 'A skill', 1),
      },
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.skills).toHaveLength(1);
  });

  it('falls back to config sheet when list returns empty and legacy is enabled', async () => {
    expect(LEGACY_SKILLS_SHEET_FALLBACK_ENABLED).toBe(true);

    const client = mockClient({
      listResponse: [],
      configSkills: [{ key: 'legacy-skill', content: '# Legacy\n\nOld way.' }],
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.source).toBe('site');
    expect(index.skills.some((s) => s.id === 'legacy-skill')).toBe(true);
  });

  it('falls back to config sheet on 4xx list error', async () => {
    const client = mockClient({
      listError: { status: 404 },
      configSkills: [{ key: 'sheet-skill', content: '# Sheet\n\nContent.' }],
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.source).toBe('site');
  });

  it('falls back to config sheet on 5xx list error', async () => {
    const client = mockClient({
      listError: { status: 503 },
      configSkills: [{ key: 'sheet-skill', content: '# Sheet\n\nContent.' }],
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.source).toBe('site');
  });

  it('returns empty index when fallback config sheet is also empty', async () => {
    const client = mockClient({
      listResponse: [],
      configSkills: [],
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.skills).toHaveLength(0);
    expect(index.source).toBe('none');
  });

  it('returns source=folder when skills are found via folder walk', async () => {
    const client = mockClient({
      listResponse: [{ name: 'a-skill', path: '/.da/skills/a-skill' }],
      sourceByPath: {
        '.da/skills/a-skill/skill.md': SKILL_MD('a-skill', 'Desc', 1),
      },
    });

    const index = await loadSkillsIndexFromFolders(client, 'org', 'mysite');
    expect(index.source).toBe('folder');
  });
});

// ---------------------------------------------------------------------------
// loadSkillBodyFromFolder
// ---------------------------------------------------------------------------

describe('loadSkillBodyFromFolder', () => {
  it('reads folder skill and strips frontmatter', async () => {
    const client = mockClient({
      sourceByPath: {
        '.da/skills/brand-voice/skill.md': SKILL_MD('brand-voice', 'Enforce tone', 1),
      },
    });

    const body = await loadSkillBodyFromFolder(client, 'org', 'mysite', 'brand-voice');
    expect(body).toBeTruthy();
    expect(body).toContain('Body text for brand-voice');
    expect(body).not.toContain('---');
    expect(body).not.toContain('name: brand-voice');
  });

  it('falls back to config sheet when skill.md not found', async () => {
    const client = mockClient({
      // no sourceByPath → getSource throws 404
      configSkills: [{ key: 'legacy-skill', content: '# Legacy\n\nLegacy body.' }],
    });

    const body = await loadSkillBodyFromFolder(client, 'org', 'mysite', 'legacy-skill');
    expect(body).toContain('Legacy body.');
  });

  it('returns null when not found in either location', async () => {
    const client = mockClient({
      configSkills: [],
    });

    const body = await loadSkillBodyFromFolder(client, 'org', 'mysite', 'nonexistent');
    expect(body).toBeNull();
  });

  it('returns null for empty skill id', async () => {
    const body = await loadSkillBodyFromFolder(mockClient(), 'org', 'mysite', '');
    expect(body).toBeNull();
  });

  it('strips .md extension from skill id before building path', async () => {
    const client = mockClient({
      sourceByPath: {
        '.da/skills/brand-voice/skill.md': SKILL_MD('brand-voice', 'Enforce tone', 1),
      },
    });

    const body = await loadSkillBodyFromFolder(client, 'org', 'mysite', 'brand-voice.md');
    expect(body).toContain('Body text for brand-voice');
  });

  it('returns body-only content when skill has no frontmatter', async () => {
    const client = mockClient({
      sourceByPath: {
        '.da/skills/no-fm/skill.md': BODY_ONLY('no-fm'),
      },
    });

    const body = await loadSkillBodyFromFolder(client, 'org', 'mysite', 'no-fm');
    expect(body).toContain('Body text for no-fm');
  });
});
