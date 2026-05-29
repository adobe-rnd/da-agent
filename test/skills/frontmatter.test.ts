import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  stripFrontmatter,
  parseSkillIndexEntry,
} from '../../src/skills/frontmatter.js';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses a simple valid block', () => {
    const md = `---
name: brand-voice
description: Enforce brand tone guidelines
version: 3
status: approved
---
# Body`;
    const fields = parseFrontmatter(md);
    expect(fields).toEqual({
      name: 'brand-voice',
      description: 'Enforce brand tone guidelines',
      version: '3',
      status: 'approved',
    });
  });

  it('returns null when no opening delimiter', () => {
    expect(parseFrontmatter('# Just body\nno frontmatter')).toBeNull();
  });

  it('returns null when delimiter is not the first line', () => {
    expect(parseFrontmatter('\n---\nname: x\n---\n')).toBeNull();
  });

  it('lowercases all keys', () => {
    const md = `---\nName: foo\nDESCRIPTION: bar\n---\n`;
    const fields = parseFrontmatter(md);
    expect(fields).toHaveProperty('name', 'foo');
    expect(fields).toHaveProperty('description', 'bar');
  });

  it('unescapes double-quoted values', () => {
    const md = `---\ndescription: "hello \\"world\\""\n---\n`;
    const fields = parseFrontmatter(md);
    expect(fields?.description).toBe('hello "world"');
  });

  it('unescapes single-quoted values with doubled apostrophe', () => {
    const md = `---\ndescription: 'it''s fine'\n---\n`;
    const fields = parseFrontmatter(md);
    expect(fields?.description).toBe("it's fine");
  });

  it('handles bare scalars (no quoting)', () => {
    const md = `---\nname: simple-id\n---\n`;
    const fields = parseFrontmatter(md);
    expect(fields?.name).toBe('simple-id');
  });

  it('returns collected fields for unclosed block', () => {
    const md = `---\nname: partial\ndescription: no closer`;
    const fields = parseFrontmatter(md);
    expect(fields).not.toBeNull();
    expect(fields?.name).toBe('partial');
  });

  it('skips lines without a colon', () => {
    const md = `---\nname: ok\njunk line\n---\n`;
    const fields = parseFrontmatter(md);
    expect(fields).toEqual({ name: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------

describe('stripFrontmatter', () => {
  it('strips the frontmatter block and returns the body', () => {
    const md = `---
name: x
---
# Heading

Body text.`;
    expect(stripFrontmatter(md)).toBe('# Heading\n\nBody text.');
  });

  it('returns original string when no frontmatter', () => {
    const md = '# Title\n\nBody.';
    expect(stripFrontmatter(md)).toBe(md);
  });

  it('strips only the opener for an unclosed block', () => {
    const md = `---\nname: x\nnever closed`;
    const stripped = stripFrontmatter(md);
    expect(stripped).toContain('name: x');
    expect(stripped).not.toMatch(/^---/);
  });

  it('trims leading newlines after the closing delimiter', () => {
    const md = `---\nname: x\n---\n\n\n# Body`;
    expect(stripFrontmatter(md)).toBe('# Body');
  });
});

// ---------------------------------------------------------------------------
// parseSkillIndexEntry
// ---------------------------------------------------------------------------

describe('parseSkillIndexEntry', () => {
  it('returns correct fields for a valid skill', () => {
    const md = `---
name: seo-checklist
description: Run SEO checks before publish
version: 5
status: approved
---
# SEO`;
    const entry = parseSkillIndexEntry(md);
    expect(entry).toEqual({
      name: 'seo-checklist',
      description: 'Run SEO checks before publish',
      version: 5,
      status: 'approved',
    });
  });

  it('defaults status to approved when absent', () => {
    const md = `---\nname: x\ndescription: y\nversion: 1\n---\n`;
    expect(parseSkillIndexEntry(md).status).toBe('approved');
  });

  it('defaults status to approved for unrecognised values', () => {
    const md = `---\nname: x\ndescription: y\nversion: 1\nstatus: pending\n---\n`;
    expect(parseSkillIndexEntry(md).status).toBe('approved');
  });

  it('recognises draft status', () => {
    const md = `---\nname: x\ndescription: y\nversion: 1\nstatus: draft\n---\n`;
    expect(parseSkillIndexEntry(md).status).toBe('draft');
  });

  it('returns version 0 for a non-numeric version', () => {
    const md = `---\nname: x\ndescription: y\nversion: abc\n---\n`;
    expect(parseSkillIndexEntry(md).version).toBe(0);
  });

  it('returns version 0 when version is absent', () => {
    const md = `---\nname: x\ndescription: y\n---\n`;
    expect(parseSkillIndexEntry(md).version).toBe(0);
  });

  it('returns empty strings when frontmatter is absent', () => {
    const entry = parseSkillIndexEntry('# No frontmatter');
    expect(entry.name).toBe('');
    expect(entry.description).toBe('');
    expect(entry.version).toBe(0);
  });

  it('does not throw on empty string', () => {
    expect(() => parseSkillIndexEntry('')).not.toThrow();
  });
});
