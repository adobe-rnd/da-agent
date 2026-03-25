/**
 * DOM Operations
 *
 * Pure functions that apply atomic document operations to an EDS HTML string.
 * Each function accepts HTML in, returns updated HTML out — no side effects.
 *
 * Uses the global DOMParser when available (browser, happy-dom test env), and falls
 * back to linkedom's parseHTML in Cloudflare Workers where the global is absent.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseHTML as linkedomParseHTML } from 'linkedom';
import type { DocumentOperation } from './operations.js';

/**
 * Parse an HTML string into a DOM document.
 * Uses the global DOMParser when available (browser / happy-dom test env).
 * Falls back to linkedom's parseHTML in Cloudflare Workers where DOMParser is absent.
 *
 * The input html is the body's outerHTML (starts with "<body>"). When passing a
 * fragment that begins with "<body>" to linkedomParseHTML, any leading whitespace
 * causes the parser to treat the explicit <body> tag as an unknown child element
 * rather than as the document body, making document.body empty. Wrapping in a
 * complete HTML document structure prevents this.
 */
function parseDom(html: string): any {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof globalThis.DOMParser !== 'undefined') {
    return new (globalThis.DOMParser as any)().parseFromString(html, 'text/html');
  }
  // CF Workers: wrap in a full document so linkedom correctly maps <body> to document.body
  const fullDoc = `<!DOCTYPE html><html><head></head>${html.trim()}</html>`;
  return (linkedomParseHTML(fullDoc) as any).document;
}

// ---------------------------------------------------------------------------
// Internal DOM helpers (all work on `any` to avoid DOM vs Workers-types conflicts)
// ---------------------------------------------------------------------------

/**
 * Return all direct block-level children of all section <div>s within <main>.
 * Maps 1:1 to the top-level content nodes in the Y.XmlFragment.
 */
function getBlockElements(dom: any): any[] {
  const main = dom.body?.querySelector?.('main');
  if (!main) return Array.from(dom.body?.children ?? []);
  const sections: any[] = Array.from(main.children ?? []);
  return sections.flatMap((section: any) => Array.from(section.children ?? []));
}

/**
 * Walk up the DOM tree from `element` to find the block-level ancestor.
 * Returns its 0-based index in the flat block list, or -1 if not found.
 */
function getBlockIndex(dom: any, element: any): number {
  const blocks = getBlockElements(dom);
  let el = element;
  while (el) {
    const idx = blocks.indexOf(el);
    if (idx >= 0) return idx;
    el = el.parentElement ?? null;
  }
  return -1;
}

/**
 * Find the nth element (any depth) whose textContent includes `anchor`.
 * Optionally filtered by `anchorType` CSS selector.
 * Used for operations that target non-block elements (e.g. <a>, <img>).
 */
/**
 * Find the nth element (any depth) whose textContent includes `anchor`.
 * Iterates innermost-first so the most specific (deepest) match is preferred.
 * Optionally filtered by `anchorType` CSS selector.
 * Used for operations that target non-block elements (e.g. <a>, <img>).
 */
function findElement(
  dom: any,
  anchor: string,
  anchorType?: string,
  anchorIndex = 1,
): any | null {
  const selector = anchorType ?? '*';
  // Reverse document order so innermost (most-specific) elements are checked first
  const allElements: any[] = Array.from(dom.body?.querySelectorAll?.(selector) ?? []).reverse();
  let matchCount = 0;
  for (const el of allElements) {
    if ((el.textContent ?? '').includes(anchor)) {
      matchCount += 1;
      if (matchCount === anchorIndex) return el;
    }
  }
  return null;
}

/**
 * Find the nth block element whose textContent includes `anchor`.
 * Optionally filtered by `anchorType` CSS selector.
 */
function findAnchorBlock(
  dom: any,
  anchor: string,
  anchorType?: string,
  anchorIndex = 1,
): any | null {
  const blocks = getBlockElements(dom);
  let matchCount = 0;
  for (const block of blocks) {
    const typeMatch = !anchorType || block.matches?.(anchorType);
    if (typeMatch && (block.textContent ?? '').includes(anchor)) {
      matchCount += 1;
      if (matchCount === anchorIndex) return block;
    }
  }
  return null;
}

/**
 * Walk all text nodes under `root`, find the nth occurrence of `find`,
 * capture the parent block index (pre-mutation), then replace the text.
 */
function applyReplaceText(
  dom: any,
  find: string,
  replace: string,
  nth: number,
): { success: boolean; blockIndex: number; message: string } {
  let count = 0;
  let blockIndex = -1;
  let found = false;

  const walk = (node: any): boolean => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text: string = node.textContent ?? '';
      const idx = text.indexOf(find);
      if (idx >= 0) {
        count += 1;
        if (count === nth) {
          // Capture block index before mutation
          let el = node.parentNode;
          while (el && el.nodeType !== 1) el = el.parentNode;
          if (el) blockIndex = getBlockIndex(dom, el);
          node.textContent = text.slice(0, idx) + replace + text.slice(idx + find.length);
          found = true;
          return true;
        }
      }
    }
    for (const child of Array.from(node.childNodes ?? [])) {
      if (walk(child)) return true;
    }
    return false;
  };

  walk(dom.body);
  if (!found) {
    return {
      success: false,
      blockIndex: -1,
      message: `Text "${find}" not found (occurrence ${nth})`,
    };
  }
  return {
    success: true,
    blockIndex,
    message: `Replaced "${find}" with "${replace}"`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OperationApplyResult = {
  newHtml: string;
  blockIndex: number;
  success: boolean;
  message: string;
};

/**
 * Apply a single atomic operation to an EDS HTML string.
 * Returns the updated HTML string and a cursor block index (0-based, -1 if unknown).
 * Does not mutate the input string; always returns a new string on success.
 */
export function applyOperation(html: string, op: DocumentOperation): OperationApplyResult {
  const dom: any = parseDom(html);

  let blockIndex = -1;
  let success = false;
  let message = '';

  switch (op.type) {
    case 'replace_text': {
      const r = applyReplaceText(dom, op.find, op.replace, op.nth ?? 1);
      blockIndex = r.blockIndex;
      success = r.success;
      message = r.message;
      break;
    }

    case 'insert_element': {
      const anchor = findAnchorBlock(dom, op.anchor, op.anchorType, op.anchorIndex ?? 1);
      if (!anchor) {
        return {
          newHtml: html,
          blockIndex: -1,
          success: false,
          message: `Anchor "${op.anchor}" not found`,
        };
      }
      blockIndex = getBlockIndex(dom, anchor);
      // Use outerHTML setter instead of insertAdjacentHTML — the latter is not available
      // in the Cloudflare Workers DOMParser runtime.
      if (op.insertPosition === 'before') {
        anchor.outerHTML = op.html + anchor.outerHTML;
      } else {
        anchor.outerHTML += op.html;
      }
      success = true;
      message = `Element inserted ${op.insertPosition} "${op.anchor}"`;
      break;
    }

    case 'delete_element': {
      const target = findAnchorBlock(dom, op.anchor, op.anchorType, op.anchorIndex ?? 1);
      if (!target) {
        return {
          newHtml: html,
          blockIndex: -1,
          success: false,
          message: `Element "${op.anchor}" not found`,
        };
      }
      blockIndex = getBlockIndex(dom, target);
      target.remove();
      success = true;
      message = `Deleted element containing "${op.anchor}"`;
      break;
    }

    case 'replace_element': {
      const target = findAnchorBlock(dom, op.anchor, op.anchorType, op.anchorIndex ?? 1);
      if (!target) {
        return {
          newHtml: html,
          blockIndex: -1,
          success: false,
          message: `Element "${op.anchor}" not found`,
        };
      }
      blockIndex = getBlockIndex(dom, target);
      target.outerHTML = op.html;
      success = true;
      message = `Replaced element containing "${op.anchor}"`;
      break;
    }

    case 'update_attribute': {
      // Use full-DOM search so non-block elements (e.g. <a>, <img>) can be targeted
      const target = findElement(dom, op.anchor, op.anchorType, op.anchorIndex ?? 1);
      if (!target) {
        return {
          newHtml: html,
          blockIndex: -1,
          success: false,
          message: `Element "${op.anchor}" not found`,
        };
      }
      blockIndex = getBlockIndex(dom, target); // walks up to block level for cursor
      target.setAttribute(op.attribute, op.value);
      success = true;
      message = `Set ${op.attribute}="${op.value}" on element containing "${op.anchor}"`;
      break;
    }

    default:
      return {
        newHtml: html,
        blockIndex: -1,
        success: false,
        message: 'Unknown operation type',
      };
  }

  return {
    newHtml: success ? (dom.body.outerHTML as string) : html,
    blockIndex,
    success,
    message,
  };
}
