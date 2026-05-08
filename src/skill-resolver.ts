/**
 * Skill + agent loading extracted from handleChat.
 * Resolves the skills index, agent preset, agent skill contents,
 * and explicitly requested skill contents.
 *
 * NEW MODULE — extracted from server.ts handleChat.
 * The ResolvedSkills interface and resolveSkillsAndAgent signature are new.
 * All inner logic is moved verbatim from main's server.ts.
 */

import { loadSkillsIndex, loadSkillContent } from './skills/loader.js';
import type { SkillsIndex } from './skills/loader.js';
import { loadAgentPreset } from './agents/loader.js';
import type { AgentPreset } from './agents/loader.js';
import type { ChatContext } from './chat-context.js';

export interface ResolvedSkills {
  skillsIndex: SkillsIndex | null;
  activeAgent: AgentPreset | null;
  agentSkillContents: Record<string, string>;
  requestedSkillContents: Record<string, string>;
}

export async function resolveSkillsAndAgent(
  ctx: ChatContext,
  body: { agentId?: string; requestedSkills?: string[] },
): Promise<ResolvedSkills> {
  const { adminClient, pageContext } = ctx;
  const { agentId, requestedSkills } = body;

  let skillsIndex: SkillsIndex | null = null;
  if (adminClient && pageContext) {
    try {
      skillsIndex = await loadSkillsIndex(adminClient, pageContext.org, pageContext.site);
    } catch {
      // Skills loading is best-effort
    }
  }

  let activeAgent: AgentPreset | null = null;
  let agentSkillContents: Record<string, string> = {};
  if (adminClient && pageContext && agentId) {
    try {
      activeAgent = await loadAgentPreset(adminClient, pageContext.org, pageContext.site, agentId);
      if (activeAgent && activeAgent.skills.length > 0) {
        const entries = await Promise.all(
          activeAgent.skills.map(async (sid) => {
            try {
              const content = await loadSkillContent(
                adminClient,
                pageContext.org,
                pageContext.site,
                sid,
              );
              return content ? ([sid, content] as const) : null;
            } catch {
              return null;
            }
          }),
        );
        agentSkillContents = Object.fromEntries(entries.filter(Boolean) as [string, string][]);
      }
    } catch {
      // Agent loading is best-effort
    }
  }

  let requestedSkillContents: Record<string, string> = {};
  if (requestedSkills && requestedSkills.length > 0) {
    console.log('[da-agent] requestedSkills:', requestedSkills);
    if (adminClient && pageContext) {
      const entries = await Promise.all(
        requestedSkills.map(async (sid) => {
          if (agentSkillContents[sid]) return [sid, agentSkillContents[sid]] as const;
          try {
            console.log(
              `[da-agent] loading skill "${sid}" for ${pageContext.org}/${pageContext.site}`,
            );
            const content = await loadSkillContent(
              adminClient,
              pageContext.org,
              pageContext.site,
              sid,
            );
            console.log(
              `[da-agent] skill "${sid}" loaded: ${content ? `${content.length} chars` : 'null'}`,
            );
            return content ? ([sid, content] as const) : null;
          } catch (e) {
            console.log(`[da-agent] skill "${sid}" error:`, e);
            return null;
          }
        }),
      );
      const loaded = Object.fromEntries(entries.filter(Boolean) as [string, string][]);
      requestedSkillContents = { ...requestedSkillContents, ...loaded };
      console.log('[da-agent] requestedSkillContents keys:', Object.keys(requestedSkillContents));
    } else {
      console.log(
        '[da-agent] cannot load skills: adminClient=',
        !!adminClient,
        'pageContext=',
        !!pageContext,
      );
    }
  }

  return { skillsIndex, activeAgent, agentSkillContents, requestedSkillContents };
}
