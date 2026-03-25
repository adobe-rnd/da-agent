/**
 * Atomic Document Operations
 *
 * Discriminated union of all supported document edit operations.
 * Each operation targets a specific element via an anchor (text content
 * or element type + occurrence index) and performs a minimal, targeted change.
 *
 * Extensibility: add a new operation by adding a new Zod schema to the union
 * and a handler in CollabClient.applyOperations().
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared anchor fields (reused across operations that locate an element)
// ---------------------------------------------------------------------------

const AnchorFields = {
  anchor: z
    .string()
    .describe(
      'Text content of the target element (or a distinctive substring of it). '
      + 'Used to locate the element in the document.',
    ),
  anchorType: z
    .string()
    .optional()
    .describe(
      'Optional CSS selector or tag name to narrow the search '
      + '(e.g. "h2", "p", "div.hero"). Defaults to any element.',
    ),
  anchorIndex: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Which occurrence to target when multiple elements match (1-based, default 1).'),
};

// ---------------------------------------------------------------------------
// 1. replace_text
// ---------------------------------------------------------------------------

export const ReplaceTextSchema = z.object({
  type: z.literal('replace_text'),
  find: z.string().describe('The exact text string to find in the document.'),
  replace: z.string().describe('The text to substitute in place of the found string.'),
  nth: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Which occurrence to replace (1-based, default 1).'),
});

export type ReplaceTextOperation = z.infer<typeof ReplaceTextSchema>;

// ---------------------------------------------------------------------------
// 2. insert_element
// ---------------------------------------------------------------------------

export const InsertElementSchema = z.object({
  type: z.literal('insert_element'),
  ...AnchorFields,
  insertPosition: z
    .enum(['before', 'after'])
    .describe("Where to insert relative to the anchor element: 'before' or 'after'."),
  html: z
    .string()
    .describe(
      'Valid EDS HTML fragment to insert (e.g. "<p>New paragraph.</p>" or a full block div).',
    ),
});

export type InsertElementOperation = z.infer<typeof InsertElementSchema>;

// ---------------------------------------------------------------------------
// 3. delete_element
// ---------------------------------------------------------------------------

export const DeleteElementSchema = z.object({
  type: z.literal('delete_element'),
  ...AnchorFields,
});

export type DeleteElementOperation = z.infer<typeof DeleteElementSchema>;

// ---------------------------------------------------------------------------
// 4. replace_element
// ---------------------------------------------------------------------------

export const ReplaceElementSchema = z.object({
  type: z.literal('replace_element'),
  ...AnchorFields,
  html: z
    .string()
    .describe(
      'Valid EDS HTML that replaces the entire matched element '
      + '(must be a single root element or a valid HTML fragment).',
    ),
});

export type ReplaceElementOperation = z.infer<typeof ReplaceElementSchema>;

// ---------------------------------------------------------------------------
// 5. update_attribute
// ---------------------------------------------------------------------------

export const UpdateAttributeSchema = z.object({
  type: z.literal('update_attribute'),
  ...AnchorFields,
  attribute: z
    .string()
    .describe('Name of the HTML attribute to update (e.g. "href", "src", "alt", "class").'),
  value: z.string().describe('New value for the attribute.'),
});

export type UpdateAttributeOperation = z.infer<typeof UpdateAttributeSchema>;

// ---------------------------------------------------------------------------
// 6. read_content
// ---------------------------------------------------------------------------

export const ReadContentSchema = z.object({
  type: z.literal('read_content'),
});

export type ReadContentOperation = z.infer<typeof ReadContentSchema>;

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export const DocumentOperationSchema = z.discriminatedUnion('type', [
  ReplaceTextSchema,
  InsertElementSchema,
  DeleteElementSchema,
  ReplaceElementSchema,
  UpdateAttributeSchema,
  ReadContentSchema,
]);

export type DocumentOperation =
  | ReplaceTextOperation
  | InsertElementOperation
  | DeleteElementOperation
  | ReplaceElementOperation
  | UpdateAttributeOperation
  | ReadContentOperation;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type OperationResult = {
  type: DocumentOperation['type'];
  success: boolean;
  message: string;
  /** Present for read_content operations — the current EDS HTML of the document. */
  content?: string;
};
