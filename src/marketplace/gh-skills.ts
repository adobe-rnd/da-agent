/**
 * GitHub Marketplace adapter for script-carrying skills.
 *
 * Script-carrying skills come ONLY from this curated, reviewed marketplace.
 * `.da/skills/` is user-writable site content and must never supply executable
 * scripts — that would allow any user to ship code that runs in other users'
 * browsers. Only skills from this trusted source carry `execution` metadata.
 *
 * The adapter follows the same shape as the AO adapter: it exposes a
 * `buildMarketplaceSkillsIndex()` function that returns a list of
 * `SkillSummary` entries, and `mergeMarketplaceSkillsIntoIndex()` that appends
 * them to an existing index without displacing local prose skills.
 *
 * Network calls are resilient: if the marketplace is unreachable the adapter
 * yields an empty list so the chat continues normally.
 */

// DEMO ONLY — prod target is adobe/skills (pending PR approval).
import { parseSkillIndexEntry } from '../skills/frontmatter.js';
import type { SkillSummary, SkillsIndex } from '../skills/loader.js';

const MARKETPLACE_OWNER = 'exp-workspace';
const MARKETPLACE_REPO = 'skills';
const MARKETPLACE_BRANCH = 'main';

const GH_CONTENTS_URL = `https://api.github.com/repos/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/contents/?ref=${MARKETPLACE_BRANCH}`;
const RAW_BASE_URL = `https://raw.githubusercontent.com/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/${MARKETPLACE_BRANCH}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of one entry from the GH contents API response. */
interface GHContentsEntry {
  name: string;
  type: string; // "dir" | "file" | ...
  path: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Skill folder names must match `[a-z0-9-]+` (same rule as .da/skills). */
const SKILL_FOLDER_RE = /^[a-z0-9-]+$/;

async function fetchJson<T>(url: string): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { data: (await res.json()) as T };
  } catch (err) {
    return { error: String(err) };
  }
}

async function fetchText(url: string): Promise<{ text: string } | { error: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (err) {
    return { error: String(err) };
  }
}

/**
 * Map a runtime identifier to its file extension.
 * Currently only `js` is supported; unknown runtimes fall back to the runtime
 * name itself (e.g. `wasm` → `.wasm`).
 */
function runtimeToExt(runtime: string): string {
  return `.${runtime}`;
}

/**
 * Check whether `<id>/scripts/<entry>.<ext>` is present in the skill's
 * `scripts/` sub-folder listing.
 *
 * The extension is derived from the first supported runtime (e.g. `js` → `.js`).
 * Returns `false` when the `scripts/` folder does not exist, the network is
 * unreachable, or the expected file is not found.
 */
async function hasMarketplaceScript(
  id: string,
  entry: string,
  runtimes: string[],
): Promise<boolean> {
  if (!entry || runtimes.length === 0) return false;
  const ext = runtimeToExt(runtimes[0]);
  const expectedFile = `${entry}${ext}`;
  const url = `https://api.github.com/repos/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/contents/${id}/scripts?ref=${MARKETPLACE_BRANCH}`;
  const result = await fetchJson<GHContentsEntry[]>(url);
  if ('error' in result) return false;
  return result.data.some((e) => e.name === expectedFile && e.type === 'file');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all script-carrying skills from the GH marketplace.
 *
 * 1. Lists top-level directories via the GH contents API.
 * 2. For each directory whose name matches `[a-z0-9-]+`:
 *    a. Fetches `<id>/skill.md` and parses execution frontmatter.
 *    b. Confirms `<id>/scripts/<entry>.<ext>` is present in the `scripts/`
 *       sub-folder (entry from `execution_entry`, ext from first runtime).
 * 3. Returns only skills that have `execution_entry` AND the scripts file.
 *
 * Returns an empty array on any network/parse failure.
 */
export async function buildMarketplaceSkillsIndex(): Promise<SkillSummary[]> {
  const rootResult = await fetchJson<GHContentsEntry[]>(GH_CONTENTS_URL);
  if ('error' in rootResult) {
    // Marketplace unreachable — degrade gracefully.
    console.warn('[da-agent:marketplace]', 'GH contents fetch failed:', rootResult.error);
    return [];
  }

  const dirs = rootResult.data.filter(
    (entry) => entry.type === 'dir' && SKILL_FOLDER_RE.test(entry.name),
  );

  const results = await Promise.all(
    dirs.map(async (dir): Promise<SkillSummary | null> => {
      const id = dir.name;
      const skillMdUrl = `${RAW_BASE_URL}/${id}/skill.md`;
      const mdResult = await fetchText(skillMdUrl);
      if ('error' in mdResult) return null;

      const indexed = parseSkillIndexEntry(mdResult.text);
      if (indexed.status === 'draft') return null;
      if (!indexed.execution) return null; // no execution_entry → prose-only, skip

      const hasScript = await hasMarketplaceScript(
        id,
        indexed.execution.entry,
        indexed.execution.runtimes,
      );
      if (!hasScript) return null;

      const title = indexed.description || indexed.name || id;
      const summary: SkillSummary = {
        id,
        title,
        execution: indexed.execution,
        source: 'marketplace',
      };
      return summary;
    }),
  );

  return results.filter((s): s is SkillSummary => s !== null);
}

/**
 * Append marketplace script-skills to an existing index.
 *
 * Local prose skills are never displaced. Marketplace skills are appended
 * at the end so local skills always appear first in the system prompt.
 *
 * If the marketplace fetch fails, the original index is returned unchanged.
 */
export async function mergeMarketplaceSkillsIntoIndex(index: SkillsIndex): Promise<SkillsIndex> {
  const marketplaceSkills = await buildMarketplaceSkillsIndex();
  if (marketplaceSkills.length === 0) return index;
  return {
    ...index,
    skills: [...index.skills, ...marketplaceSkills],
  };
}
