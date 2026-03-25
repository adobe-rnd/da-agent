// @vitest-environment happy-dom

/**
 * Tests for applyOperation — requires a DOM environment (happy-dom) to
 * provide DOMParser, which is declared as a global in dom-operations.ts.
 */

import { describe, it, expect } from 'vitest';
import { applyOperation } from '../src/tools/dom-operations.js';

const BASE_HTML = '<body><main><div>'
  + '<h2>Introduction</h2>'
  + '<p>Hello world</p>'
  + '<p>Second paragraph</p>'
  + '<div class="hero"><div><div><h1>Hero title</h1></div></div></div>'
  + '</div></main></body>';

// ---------------------------------------------------------------------------
// replace_text
// ---------------------------------------------------------------------------

describe('applyOperation — replace_text', () => {
  it('replaces the first occurrence of a text string', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_text',
      find: 'Hello world',
      replace: 'Hi there',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('Hi there');
    expect(result.newHtml).not.toContain('Hello world');
  });

  it('returns the correct blockIndex for the modified element', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_text',
      find: 'Hello world',
      replace: 'Hi',
    });
    // "Hello world" is in the first <p> which is index 1 (after <h2>)
    expect(result.blockIndex).toBe(1);
  });

  it('replaces the nth occurrence when specified', () => {
    const html = '<body><main><div><p>foo</p><p>foo</p><p>foo</p></div></main></body>';
    const result = applyOperation(html, {
      type: 'replace_text',
      find: 'foo',
      replace: 'bar',
      nth: 2,
    });
    expect(result.success).toBe(true);
    // Only the second "foo" should be replaced
    const matches = (result.newHtml.match(/foo/g) ?? []).length;
    expect(matches).toBe(2);
    const bars = (result.newHtml.match(/bar/g) ?? []).length;
    expect(bars).toBe(1);
  });

  it('returns failure when text is not found', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_text',
      find: 'nonexistent text',
      replace: 'anything',
    });
    expect(result.success).toBe(false);
    expect(result.newHtml).toBe(BASE_HTML);
    expect(result.message).toContain('not found');
  });

  it('returns failure when nth occurrence does not exist', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_text',
      find: 'Hello world',
      replace: 'Hi',
      nth: 5,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// insert_element
// ---------------------------------------------------------------------------

describe('applyOperation — insert_element', () => {
  it('inserts an element after the anchor', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'insert_element',
      anchor: 'Hello world',
      insertPosition: 'after',
      html: '<p>Inserted paragraph.</p>',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('Inserted paragraph.');
    // Should appear after the Hello world paragraph
    const insertedIdx = result.newHtml.indexOf('Inserted paragraph.');
    const anchorIdx = result.newHtml.indexOf('Hello world');
    expect(insertedIdx).toBeGreaterThan(anchorIdx);
  });

  it('inserts an element before the anchor', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'insert_element',
      anchor: 'Introduction',
      insertPosition: 'before',
      html: '<h1>Page Title</h1>',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('Page Title');
    const titleIdx = result.newHtml.indexOf('Page Title');
    const introIdx = result.newHtml.indexOf('Introduction');
    expect(titleIdx).toBeLessThan(introIdx);
  });

  it('returns the blockIndex of the anchor element', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'insert_element',
      anchor: 'Introduction',
      insertPosition: 'after',
      html: '<p>After intro.</p>',
    });
    // <h2>Introduction</h2> is index 0 in the block list
    expect(result.blockIndex).toBe(0);
  });

  it('returns failure when anchor is not found', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'insert_element',
      anchor: 'Nonexistent section',
      insertPosition: 'after',
      html: '<p>x</p>',
    });
    expect(result.success).toBe(false);
    expect(result.newHtml).toBe(BASE_HTML);
  });

  it('targets the nth anchor when anchorIndex is specified', () => {
    const html = '<body><main><div><p>Item</p><p>Item</p><p>Item</p></div></main></body>';
    const result = applyOperation(html, {
      type: 'insert_element',
      anchor: 'Item',
      anchorIndex: 2,
      insertPosition: 'after',
      html: '<p>Inserted.</p>',
    });
    expect(result.success).toBe(true);
    // "Inserted." should appear somewhere after position 0
    expect(result.newHtml.indexOf('Inserted.')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// delete_element
// ---------------------------------------------------------------------------

describe('applyOperation — delete_element', () => {
  it('removes an element by its text content', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'delete_element',
      anchor: 'Second paragraph',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).not.toContain('Second paragraph');
  });

  it('does not affect other elements', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'delete_element',
      anchor: 'Second paragraph',
    });
    expect(result.newHtml).toContain('Hello world');
    expect(result.newHtml).toContain('Introduction');
  });

  it('returns blockIndex of the deleted element', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'delete_element',
      anchor: 'Introduction',
    });
    expect(result.blockIndex).toBe(0);
  });

  it('returns failure when anchor is not found', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'delete_element',
      anchor: 'does not exist',
    });
    expect(result.success).toBe(false);
    expect(result.newHtml).toBe(BASE_HTML);
  });

  it('targets element by anchorType', () => {
    // Delete only the <h2> matching 'Introduction', not a <p> if one existed
    const result = applyOperation(BASE_HTML, {
      type: 'delete_element',
      anchor: 'Introduction',
      anchorType: 'h2',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).not.toContain('<h2>Introduction</h2>');
  });
});

// ---------------------------------------------------------------------------
// replace_element
// ---------------------------------------------------------------------------

describe('applyOperation — replace_element', () => {
  it('replaces an element with new HTML', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_element',
      anchor: 'Introduction',
      html: '<h2>Getting Started</h2>',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('Getting Started');
    expect(result.newHtml).not.toContain('<h2>Introduction</h2>');
  });

  it('returns blockIndex of the replaced element', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_element',
      anchor: 'Introduction',
      html: '<h2>New</h2>',
    });
    expect(result.blockIndex).toBe(0);
  });

  it('returns failure when anchor is not found', () => {
    const result = applyOperation(BASE_HTML, {
      type: 'replace_element',
      anchor: 'Missing section',
      html: '<p>x</p>',
    });
    expect(result.success).toBe(false);
    expect(result.newHtml).toBe(BASE_HTML);
  });
});

// ---------------------------------------------------------------------------
// update_attribute
// ---------------------------------------------------------------------------

describe('applyOperation — update_attribute', () => {
  const HTML_WITH_LINK = '<body><main><div>'
    + '<p><a href="/old/path">Read more</a></p>'
    + '</div></main></body>';

  it('updates the href attribute of an anchor element', () => {
    const result = applyOperation(HTML_WITH_LINK, {
      type: 'update_attribute',
      anchor: 'Read more',
      attribute: 'href',
      value: '/new/path',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('href="/new/path"');
    expect(result.newHtml).not.toContain('href="/old/path"');
  });

  it('returns blockIndex of the containing element', () => {
    const result = applyOperation(HTML_WITH_LINK, {
      type: 'update_attribute',
      anchor: 'Read more',
      attribute: 'href',
      value: '/x',
    });
    expect(result.blockIndex).toBe(0);
  });

  it('returns failure when anchor is not found', () => {
    const result = applyOperation(HTML_WITH_LINK, {
      type: 'update_attribute',
      anchor: 'Missing link',
      attribute: 'href',
      value: '/x',
    });
    expect(result.success).toBe(false);
    expect(result.newHtml).toBe(HTML_WITH_LINK);
  });

  it('adds a new attribute that did not exist before', () => {
    const result = applyOperation(HTML_WITH_LINK, {
      type: 'update_attribute',
      anchor: 'Read more',
      attribute: 'target',
      value: '_blank',
    });
    expect(result.success).toBe(true);
    expect(result.newHtml).toContain('target="_blank"');
  });
});
