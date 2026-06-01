import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/prompt-builder.js';

describe('buildSystemPrompt', () => {
  it('returns a non-empty string with no arguments', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('Document Authoring');
  });

  it('includes critical tool usage instructions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('NEVER mention tool names');
    expect(prompt).toContain('NEVER output raw HTML');
  });

  it('includes EDS HTML rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('<body>');
    expect(prompt).toContain('Edge Delivery Services');
  });

  it('includes rich response formatting', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(':::list');
    expect(prompt).toContain(':::checklist');
    expect(prompt).toContain(':::alert-info');
  });

  it('includes skill suggestion instructions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('[SKILL_SUGGESTION]');
    expect(prompt).toContain('SKILL_ID:');
  });
});

describe('buildSystemPrompt with pageContext', () => {
  const pageContext = { org: 'adobe', site: 'my-docs', path: '/index.html', view: 'edit' };

  it('includes page context section', () => {
    const prompt = buildSystemPrompt(pageContext);
    expect(prompt).toContain('adobe');
    expect(prompt).toContain('my-docs');
    expect(prompt).toContain('/index.html');
  });

  it('includes live preview URL', () => {
    const prompt = buildSystemPrompt(
      pageContext,
      null,
      null,
      null,
      undefined,
      null,
      null,
      null,
      'production',
    );
    expect(prompt).toContain('preview.da.live');
    expect(prompt).toContain('main--my-docs--adobe');
  });

  it('uses stage preview URL for non-production', () => {
    const prompt = buildSystemPrompt(
      pageContext,
      null,
      null,
      null,
      undefined,
      null,
      null,
      null,
      'ci',
    );
    expect(prompt).toContain('stage-preview.da.live');
  });

  it('includes edit view rules for edit view', () => {
    const prompt = buildSystemPrompt(pageContext);
    expect(prompt).toContain('Document replace rules');
    expect(prompt).toContain('ALWAYS call content_read');
  });

  it('omits edit view rules for non-edit view', () => {
    const browseCtx = { ...pageContext, view: 'browse' };
    const prompt = buildSystemPrompt(browseCtx);
    expect(prompt).not.toContain('Document replace rules');
  });

  it('includes memory instructions', () => {
    const prompt = buildSystemPrompt(pageContext);
    expect(prompt).toContain('write_project_memory');
  });
});

describe('buildSystemPrompt with MCP config', () => {
  it('includes MCP server section', () => {
    const mcpConfig = {
      mcpServers: { 'my-server': { type: 'http' as const, url: 'https://mcp.example.com' } },
      toolAllowPatterns: ['mcp__my-server__*'],
    };
    const prompt = buildSystemPrompt(undefined, mcpConfig);
    expect(prompt).toContain('my-server');
    expect(prompt).toContain('mcp__my-server__');
  });

  it('includes built-in server instructions', () => {
    const mcpConfig = {
      mcpServers: { 'governance-agent': { type: 'http' as const, url: 'https://example.com' } },
      toolAllowPatterns: ['mcp__governance-agent__*'],
    };
    const builtIn = {
      'governance-agent': {
        type: 'http' as const,
        url: 'https://example.com',
        sendImsToken: true,
        instructions: 'Use Live Preview URL',
      },
    };
    const prompt = buildSystemPrompt(
      undefined,
      mcpConfig,
      null,
      null,
      undefined,
      null,
      null,
      null,
      undefined,
      builtIn,
    );
    expect(prompt).toContain('Use Live Preview URL');
  });

  it('omits MCP section when no servers', () => {
    const prompt = buildSystemPrompt(undefined, null);
    expect(prompt).not.toContain('Available MCP Servers');
  });
});

describe('buildSystemPrompt with skills', () => {
  it('includes skills index section', () => {
    const skillsIndex = { skills: [{ id: 'seo-check', title: 'SEO Check' }] };
    const prompt = buildSystemPrompt(undefined, null, skillsIndex);
    expect(prompt).toContain('seo-check');
    expect(prompt).toContain('SEO Check');
    expect(prompt).toContain('Available Skills');
  });

  it('omits skills section when empty', () => {
    const prompt = buildSystemPrompt(undefined, null, { skills: [] });
    expect(prompt).not.toContain('Available Skills');
  });
});

describe('buildSystemPrompt with agent', () => {
  it('includes agent section', () => {
    const agent = {
      id: 'a1',
      name: 'Brand Helper',
      description: 'Helps with branding',
      systemPrompt: 'You are a brand expert',
      skills: [],
    };
    const prompt = buildSystemPrompt(undefined, null, null, agent);
    expect(prompt).toContain('Brand Helper');
    expect(prompt).toContain('You are a brand expert');
  });

  it('includes pre-loaded skill contents', () => {
    const agent = {
      id: 'a1',
      name: 'Helper',
      description: 'desc',
      systemPrompt: 'prompt',
      skills: ['my-skill'],
    };
    const skillContents = { 'my-skill': '# My Skill\nDo this and that.' };
    const prompt = buildSystemPrompt(undefined, null, null, agent, skillContents);
    expect(prompt).toContain('My Skill');
    expect(prompt).toContain('Do this and that');
    expect(prompt).toContain('Pre-loaded Skills');
  });
});

describe('buildSystemPrompt with requested skills', () => {
  it('includes explicitly invoked skills', () => {
    const requested = { contents: { 'seo-audit': '# SEO Audit\nRun the audit.' }, missing: [] };
    const prompt = buildSystemPrompt(
      undefined,
      null,
      null,
      null,
      undefined,
      null,
      null,
      null,
      undefined,
      undefined,
      requested,
    );
    expect(prompt).toContain('Explicitly Invoked');
    expect(prompt).toContain('seo-audit');
    expect(prompt).toContain('Run the audit');
  });

  it('includes missing skill warning', () => {
    const requested = { contents: {}, missing: ['nonexistent'] };
    const prompt = buildSystemPrompt(
      undefined,
      null,
      null,
      null,
      undefined,
      null,
      null,
      null,
      undefined,
      undefined,
      requested,
    );
    expect(prompt).toContain('Not Found');
    expect(prompt).toContain('nonexistent');
  });
});

describe('buildSystemPrompt with project memory', () => {
  it('includes project memory section', () => {
    const prompt = buildSystemPrompt(
      { org: 'a', site: 'b', path: '/c' },
      null,
      null,
      null,
      undefined,
      null,
      'This site is about cooking recipes.',
    );
    expect(prompt).toContain('Project Memory');
    expect(prompt).toContain('cooking recipes');
  });

  it('omits memory section when null', () => {
    const prompt = buildSystemPrompt(undefined, null, null, null, undefined, null, null);
    expect(prompt).not.toContain('Project Memory');
  });
});
