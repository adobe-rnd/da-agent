/**
 * Built-in skills shipped with da-agent (defined in code, not authored content).
 *
 * These exist so agent presets — including custom presets authored under
 * `.da/agents/*.json` — can reference a skill by id in their `skills` array and
 * have its body injected, without the skill living in the site's `.da/skills/`
 * folder or the legacy config sheet.
 *
 * Resolution & visibility:
 *   - `loadSkillBodyFromFolder` falls back to this registry when a skill id is
 *     not found in the folder layout (folder-authored content still wins, so a
 *     site can override a built-in by creating `.da/skills/<id>/skill.md`).
 *   - Built-in skills are intentionally NOT part of the skills index
 *     (`loadSkillsIndexFromFolders`), so they never appear in the Skills UI
 *     catalog. They are reachable only when a preset (or an explicit request)
 *     names their id.
 *
 * To add a built-in skill: add an entry to `BUILTIN_SKILLS` keyed by its id
 * (lowercase, kebab-case to match authored skill ids) and reference that id
 * from a preset's `skills` array (see `agents/builtin-presets.ts`).
 */

export interface BuiltinSkill {
  /** Human-readable title. Optional; not used for prompt injection. */
  title?: string;
  /** The skill body injected into the model prompt (no frontmatter). */
  body: string;
}

/**
 * The built-in skill registry.
 *
 * Exported (rather than kept private) so tests can register temporary entries,
 * mirroring the `_fallbackConfig` test seam in `folder-loader.ts`. Production
 * entries should be added to this literal directly.
 */
export const BUILTIN_SKILLS: Record<string, BuiltinSkill> = {
  // Example (kept minimal; add real built-in skills here):
  // 'da-authoring-basics': {
  //   title: 'DA Authoring Basics',
  //   body: 'When editing DA documents, ...',
  // },
};

/**
 * Look up a built-in skill body by id. Returns `null` when no built-in skill
 * with that id is registered.
 */
export function getBuiltinSkill(id: string): BuiltinSkill | null {
  const key = String(id || '')
    .trim()
    .replace(/\.md$/i, '');
  if (!key) return null;
  return BUILTIN_SKILLS[key] ?? null;
}
