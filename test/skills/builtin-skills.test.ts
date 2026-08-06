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
