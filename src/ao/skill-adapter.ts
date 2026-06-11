/**
 * Adapts AO plugin skills into DA's skill format.
 *
 * AO skills have richer frontmatter (apis, databases, hooks, metadata.dependencies)
 * that DA doesn't support. This adapter:
 * - Strips AO-specific frontmatter before yielding skill bodies
 * - Maps AO skill metadata to DA's SkillSummary for the skills index
 * - Prefixes skill IDs with `ao:` to avoid collision with native DA skills
 */

import type { SkillSummary, SkillsIndex } from '../skills/loader.js';
import type { AOMarketplaceClient, AOPluginRecord } from './marketplace-client.js';

export const AO_SKILL_PREFIX = 'ao:';

export function isAOSkill(skillId: string): boolean {
  return skillId.startsWith(AO_SKILL_PREFIX);
}

export function aoSkillId(pluginName: string, skillName: string): string {
  return `${AO_SKILL_PREFIX}${pluginName}/${skillName}`;
}

export function parseAOSkillId(prefixedId: string): { plugin: string; skill: string } | null {
  if (!isAOSkill(prefixedId)) return null;
  const rest = prefixedId.slice(AO_SKILL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 1) return null;
  return { plugin: rest.slice(0, slash), skill: rest.slice(slash + 1) };
}

/**
 * Build a DA-compatible SkillsIndex from AO installed plugins.
 */
export function buildAOSkillsIndex(plugins: AOPluginRecord[]): SkillSummary[] {
  const summaries: SkillSummary[] = [];

  for (const plugin of plugins) {
    for (const skill of plugin.discovered_skills ?? []) {
      summaries.push({
        id: aoSkillId(plugin.name, skill.name),
        title: skill.description || `${skill.name} (from AO plugin ${plugin.name})`,
      });
    }
  }

  return summaries;
}

/**
 * Merge AO skills into an existing DA skills index.
 */
export function mergeAOSkillsIntoIndex(
  daIndex: SkillsIndex | null,
  aoSkills: SkillSummary[],
): SkillsIndex {
  const baseSkills = daIndex?.skills ?? [];
  const source = daIndex?.source ?? 'none';

  return {
    skills: [...baseSkills, ...aoSkills],
    source: aoSkills.length > 0 && source === 'none' ? 'folder' : source,
  };
}

const AO_FM_STRIP_RE = /^---[\s\S]*?---\n*/;

/**
 * Load a single AO skill body, stripping AO-specific frontmatter.
 */
export async function loadAOSkillBody(
  client: AOMarketplaceClient,
  _pluginName: string,
  skillName: string,
): Promise<string | null> {
  try {
    const content = await client.readSkillFile(skillName);
    if (!content) return null;
    return content.replace(AO_FM_STRIP_RE, '').trim() || null;
  } catch {
    return null;
  }
}
