/**
 * Folder-based skill loader for da-agent.
 *
 * Skills are read from `.da/skills/<id>/skill.md` (new layout).
 * Falls back to the legacy config-sheet path when:
 *   - `LEGACY_SKILLS_SHEET_FALLBACK_ENABLED` is `true`, AND
 *   - the folder index is empty / the folder path is not found.
 *
 * Every legacy-path hit logs a structured warning.  When the counter has
 * been at zero for ≥7 days in alpha, PR-7 removes this fallback entirely.
 *
 * See `private-docs/skills-storage-redesign-plan.md § C + D` for the full
 * design rationale.
 */

import type { DAAdminClient } from '../da-admin/client.js';
import type { DASource } from '../da-admin/types.js';
import { parseSkillIndexEntry, stripFrontmatter } from './frontmatter.js';
import { loadSkillsIndex, loadSkillContent } from './loader.js';
import type { SkillsIndex, SkillSummary } from './loader.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SKILLS_FOLDER_BASE = '.da/skills';
export const SKILL_BODY_FILENAME = 'skill.md';

/**
 * Master switch for the legacy config-sheet fallback.
 * Set `legacyFallbackEnabled` to `false` (via PR-7) once telemetry confirms
 * zero legacy hits for ≥7 days in alpha after PR-5 is stable.
 *
 * Stored as a mutable object property so Vitest tests can override the value
 * without module-reload tricks. External code should read
 * `LEGACY_SKILLS_SHEET_FALLBACK_ENABLED` (the named export below) for
 * documentation purposes; internal logic reads `_fallbackConfig.enabled`.
 */
export const _fallbackConfig = { enabled: true };

/** Convenience re-export for documentation and PR-7 grep targets. */
export const LEGACY_SKILLS_SHEET_FALLBACK_ENABLED = _fallbackConfig.enabled;

/** Max simultaneous `skill.md` reads when building the manifest. */
const LIST_READ_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function warn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn('[da-agent:skills]', ...args);
}

/**
 * Emit a structured warning for every legacy config-sheet hit.
 * Replace with a proper OTel counter once the metrics API is wired in.
 */
function recordLegacyFallback(org: string, site: string, context: string): void {
  // eslint-disable-next-line no-console
  console.warn('[da-agent:legacy-skill-fallback]', { org, site, context });
}

/**
 * Run `fn` over `items` with at most `limit` concurrent promises.
 * Preserves result order; entries that throw resolve to `undefined`.
 */
function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let nextIndex = 0;

  function worker(): Promise<void> {
    if (nextIndex >= items.length) return Promise.resolve();
    const i = nextIndex;
    nextIndex += 1;
    return Promise.resolve(fn(items[i], i))
      .then((result) => {
        out[i] = result;
        return worker();
      })
      .catch((err) => {
        warn('mapPool worker failed', { err });
        return worker();
      });
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  return Promise.all(workers).then(() => out);
}

function isFolderEntry(source: DASource): boolean {
  return !source.ext && /^[a-z0-9-]+$/.test(source.name);
}

function buildBodyPath(id: string): string {
  return `${SKILLS_FOLDER_BASE}/${id}/${SKILL_BODY_FILENAME}`;
}

// ---------------------------------------------------------------------------
// Index loader
// ---------------------------------------------------------------------------

/**
 * Build the skills index by walking `.da/skills/` and parsing frontmatter.
 *
 * Only `skill.md` files with `status: approved` (or no status field) are
 * included.  Bodies are never loaded here — the agent fetches them on demand
 * via `da_read_skill`.
 *
 * Falls back to the legacy config-sheet path when the folder walk yields
 * zero entries and `LEGACY_SKILLS_SHEET_FALLBACK_ENABLED` is `true`.
 */
export async function loadSkillsIndexFromFolders(
  client: DAAdminClient,
  org: string,
  site: string,
): Promise<SkillsIndex> {
  let folderEntries: DASource[] = [];
  let listFailed = false;
  // 4xx means the folder doesn't exist yet (new site). still falls through to
  // the sheet so existing sheet-only skills stay visible, but we don't count
  // this as a legacy-fallback hit in telemetry — it's a normal new-site state.
  let isFolderNotFound = false;

  try {
    const items = await client.listSources(org, site, SKILLS_FOLDER_BASE);
    folderEntries = Array.isArray(items) ? items.filter(isFolderEntry) : [];
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    if (status >= 400 && status < 500) {
      isFolderNotFound = true;
    } else {
      listFailed = true;
      warn('listSources failed for skills folder', { org, site, err });
    }
  }

  if (!listFailed && folderEntries.length > 0) {
    const results = await mapPool(folderEntries, LIST_READ_CONCURRENCY, async (entry) => {
      const path = buildBodyPath(entry.name);
      try {
        // getSource returns raw text for non-HTML paths (cast is intentional)
        const raw = (await client.getSource(org, site, path)) as unknown as string;
        if (!raw || typeof raw !== 'string') return null;
        const indexed = parseSkillIndexEntry(raw);
        if (indexed.status === 'draft') return null;
        const description = indexed.description || indexed.name || entry.name;
        return { id: entry.name, title: description } satisfies SkillSummary;
      } catch (err) {
        warn('getSource failed for skill.md', { id: entry.name, path, err });
        return null;
      }
    });

    const skills = results.filter((s): s is SkillSummary => s !== null);
    // Folder was found: return its results regardless of count. An empty result
    // means all skills are draft or unreadable — that's intentional. Don't fall
    // through to the sheet, which could resurrect stale skill content.
    return { skills, source: 'folder' };
  }

  // Folder doesn't exist yet or list failed: fall back to config sheet.
  if (_fallbackConfig.enabled) {
    if (!isFolderNotFound) {
      // Only count as a legacy hit when the folder exists but has no entries
      // (or errored). A missing folder is a normal new-site state, not a hit.
      recordLegacyFallback(org, site, 'loadSkillsIndex');
    }
    return loadSkillsIndex(client, org, site);
  }

  return { skills: [], source: 'none' };
}

// ---------------------------------------------------------------------------
// Body loader
// ---------------------------------------------------------------------------

/**
 * Read the full body of a skill with frontmatter stripped.
 *
 * Tries `.da/skills/<id>/skill.md` first.  Falls back to the legacy
 * config-sheet row when the file is not found and the fallback is enabled.
 *
 * Returns `null` when the skill is not found in either location.
 */
export async function loadSkillBodyFromFolder(
  client: DAAdminClient,
  org: string,
  site: string,
  skillId: string,
): Promise<string | null> {
  const id = String(skillId || '')
    .trim()
    .replace(/\.md$/i, '');
  if (!id) return null;

  const path = buildBodyPath(id);
  try {
    const raw = (await client.getSource(org, site, path)) as unknown as string;
    if (raw && typeof raw === 'string' && raw.trim()) {
      const body = stripFrontmatter(raw).trim();
      return body || null;
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    if (status !== 404) {
      warn('getSource failed for skill body', { id, path, err });
    }
  }

  if (_fallbackConfig.enabled) {
    recordLegacyFallback(org, site, `loadSkillBody:${id}`);
    return loadSkillContent(client, org, site, id);
  }

  return null;
}
