import { describe, it, expect } from 'vitest';
import {
  DocumentOperationSchema,
  ReplaceTextSchema,
  InsertElementSchema,
  DeleteElementSchema,
  ReplaceElementSchema,
  UpdateAttributeSchema,
} from '../src/tools/operations.js';

// ---------------------------------------------------------------------------
// replace_text
// ---------------------------------------------------------------------------

describe('ReplaceTextSchema', () => {
  it('parses a minimal valid replace_text operation', () => {
    const result = ReplaceTextSchema.safeParse({
      type: 'replace_text',
      find: 'hello',
      replace: 'world',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('replace_text');
      expect(result.data.find).toBe('hello');
      expect(result.data.replace).toBe('world');
      expect(result.data.nth).toBeUndefined();
    }
  });

  it('parses a replace_text operation with nth', () => {
    const result = ReplaceTextSchema.safeParse({
      type: 'replace_text',
      find: 'foo',
      replace: 'bar',
      nth: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nth).toBe(3);
    }
  });

  it('rejects missing find field', () => {
    const result = ReplaceTextSchema.safeParse({ type: 'replace_text', replace: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects missing replace field', () => {
    const result = ReplaceTextSchema.safeParse({ type: 'replace_text', find: 'foo' });
    expect(result.success).toBe(false);
  });

  it('rejects nth = 0 (must be ≥ 1)', () => {
    const result = ReplaceTextSchema.safeParse({
      type: 'replace_text', find: 'a', replace: 'b', nth: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// insert_element
// ---------------------------------------------------------------------------

describe('InsertElementSchema', () => {
  it('parses a minimal valid insert_element operation', () => {
    const result = InsertElementSchema.safeParse({
      type: 'insert_element',
      anchor: 'Intro',
      insertPosition: 'after',
      html: '<p>New paragraph.</p>',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insertPosition).toBe('after');
      expect(result.data.html).toBe('<p>New paragraph.</p>');
    }
  });

  it('accepts insertPosition "before"', () => {
    const result = InsertElementSchema.safeParse({
      type: 'insert_element',
      anchor: 'Title',
      insertPosition: 'before',
      html: '<h1>Before</h1>',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid insertPosition', () => {
    const result = InsertElementSchema.safeParse({
      type: 'insert_element',
      anchor: 'Title',
      insertPosition: 'inside',
      html: '<p>x</p>',
    });
    expect(result.success).toBe(false);
  });

  it('parses anchorType and anchorIndex', () => {
    const result = InsertElementSchema.safeParse({
      type: 'insert_element',
      anchor: 'Title',
      anchorType: 'h2',
      anchorIndex: 2,
      insertPosition: 'after',
      html: '<p>x</p>',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anchorType).toBe('h2');
      expect(result.data.anchorIndex).toBe(2);
    }
  });

  it('rejects missing html field', () => {
    const result = InsertElementSchema.safeParse({
      type: 'insert_element',
      anchor: 'Title',
      insertPosition: 'after',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// delete_element
// ---------------------------------------------------------------------------

describe('DeleteElementSchema', () => {
  it('parses a valid delete_element operation', () => {
    const result = DeleteElementSchema.safeParse({
      type: 'delete_element',
      anchor: 'Remove this paragraph',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anchor).toBe('Remove this paragraph');
    }
  });

  it('rejects missing anchor', () => {
    const result = DeleteElementSchema.safeParse({ type: 'delete_element' });
    expect(result.success).toBe(false);
  });

  it('parses optional anchorType and anchorIndex', () => {
    const result = DeleteElementSchema.safeParse({
      type: 'delete_element',
      anchor: 'Old section',
      anchorType: 'div.hero',
      anchorIndex: 1,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replace_element
// ---------------------------------------------------------------------------

describe('ReplaceElementSchema', () => {
  it('parses a valid replace_element operation', () => {
    const result = ReplaceElementSchema.safeParse({
      type: 'replace_element',
      anchor: 'Old heading text',
      html: '<h2>New heading</h2>',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.html).toBe('<h2>New heading</h2>');
    }
  });

  it('rejects missing html field', () => {
    const result = ReplaceElementSchema.safeParse({
      type: 'replace_element',
      anchor: 'Something',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update_attribute
// ---------------------------------------------------------------------------

describe('UpdateAttributeSchema', () => {
  it('parses a valid update_attribute operation', () => {
    const result = UpdateAttributeSchema.safeParse({
      type: 'update_attribute',
      anchor: 'Read more',
      attribute: 'href',
      value: '/new/path',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attribute).toBe('href');
      expect(result.data.value).toBe('/new/path');
    }
  });

  it('rejects missing attribute field', () => {
    const result = UpdateAttributeSchema.safeParse({
      type: 'update_attribute',
      anchor: 'link',
      value: '/path',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing value field', () => {
    const result = UpdateAttributeSchema.safeParse({
      type: 'update_attribute',
      anchor: 'link',
      attribute: 'href',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DocumentOperationSchema discriminated union
// ---------------------------------------------------------------------------

describe('DocumentOperationSchema', () => {
  it('correctly identifies each operation type', () => {
    const ops = [
      { type: 'replace_text', find: 'a', replace: 'b' },
      {
        type: 'insert_element', anchor: 'x', insertPosition: 'after', html: '<p/>',
      },
      { type: 'delete_element', anchor: 'x' },
      { type: 'replace_element', anchor: 'x', html: '<p/>' },
      {
        type: 'update_attribute', anchor: 'x', attribute: 'href', value: '/x',
      },
    ];
    for (const op of ops) {
      const result = DocumentOperationSchema.safeParse(op);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(op.type);
      }
    }
  });

  it('rejects an unknown operation type', () => {
    const result = DocumentOperationSchema.safeParse({ type: 'move_element', anchor: 'x' });
    expect(result.success).toBe(false);
  });
});
