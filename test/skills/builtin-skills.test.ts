import { describe, it, expect, afterEach } from 'vitest';
import { BUILTIN_SKILLS, getBuiltinSkill } from '../../src/skills/builtin-skills.js';

// Register temporary built-ins for the test, mirroring the `_fallbackConfig`
// mutable-seam pattern used elsewhere in the skills tests.
const TEST_IDS = ['test-builtin', 'trim-me'];

afterEach(() => {
  for (const id of TEST_IDS) delete BUILTIN_SKILLS[id];
});

describe('getBuiltinSkill', () => {
  it('returns null for an unregistered id', () => {
    expect(getBuiltinSkill('does-not-exist')).toBeNull();
  });

  it('returns null for empty/blank ids', () => {
    expect(getBuiltinSkill('')).toBeNull();
    expect(getBuiltinSkill('   ')).toBeNull();
  });

  it('returns a registered built-in skill', () => {
    BUILTIN_SKILLS['test-builtin'] = { title: 'Test', body: 'Do the thing.' };
    const skill = getBuiltinSkill('test-builtin');
    expect(skill).not.toBeNull();
    expect(skill?.body).toBe('Do the thing.');
    expect(skill?.title).toBe('Test');
  });

  it('normalizes a trailing .md and surrounding whitespace in the id', () => {
    BUILTIN_SKILLS['trim-me'] = { body: 'x' };
    expect(getBuiltinSkill('  trim-me.md  ')?.body).toBe('x');
  });
});

describe('DA Structured Content built-in skills', () => {
  const SC_SKILL_IDS = [
    'compute-editor-urls',
    'generate-schema',
    'serialize-structured-content',
    'import-structured-content',
    'validate-structured-content',
    'author-structured-content',
  ];

  it.each(SC_SKILL_IDS)('resolves "%s" with non-empty body', (id) => {
    const skill = getBuiltinSkill(id);
    expect(skill).not.toBeNull();
    expect(skill!.body.trim().length).toBeGreaterThan(0);
  });

  it.each(SC_SKILL_IDS)(
    '"%s" contains no Claude-Code Skill() delegation syntax (da-agent has no such tool)',
    (id) => {
      const skill = getBuiltinSkill(id);
      expect(skill!.body).not.toContain('Skill(skill=');
      expect(skill!.body).not.toContain('mode=delegated');
    },
  );

  it.each(SC_SKILL_IDS)('"%s" references da-agent tool names, not da-sc-mcp doc names', (id) => {
    const skill = getBuiltinSkill(id);
    expect(skill!.body).not.toContain('da_get_source');
    expect(skill!.body).not.toContain('da_create_source');
  });
});
