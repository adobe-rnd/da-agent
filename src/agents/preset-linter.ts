import type { AgentPreset } from './loader.js';

export interface LintFinding {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  field: 'systemPrompt' | 'description' | 'name' | 'skills' | 'mcpServers';
  match?: string;
}

export interface LintResult {
  pass: boolean;
  findings: LintFinding[];
}

interface InjectionPattern {
  id: string;
  severity: 'error' | 'warning';
  pattern: RegExp;
  message: string;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: 'injection/role-override',
    severity: 'error',
    pattern: /\b(?:you are now a|your new role is|act as a|pretend (?:to be|you're))\b/i,
    message: 'Detected role-override language that could hijack the agent persona',
  },
  {
    id: 'injection/instruction-override',
    severity: 'error',
    pattern:
      /\b(?:ignore|disregard|override|forget)\b.{0,20}\b(?:all|previous|prior|above|earlier|system)\b.{0,20}\b(?:instructions?|rules?|prompts?|guidelines?)?\b/i,
    message: 'Detected instruction-override pattern that could bypass system prompt',
  },
  {
    id: 'injection/exfiltration',
    severity: 'error',
    pattern:
      /\b(?:send|transmit|post|exfiltrate|leak)\b.{0,30}\b(?:token|secret|key|credential|password|cookie)\b/i,
    message: 'Detected potential data exfiltration instruction',
  },
  {
    id: 'injection/token-embedding',
    severity: 'error',
    pattern:
      /\b(?:embed|include|insert|append)\b.{0,20}\b(?:token|imsToken|access.?token|api.?key)\b.{0,20}\b(?:in|into|within)\b/i,
    message: 'Detected instruction to embed credentials in output',
  },
  {
    id: 'injection/prompt-leaking',
    severity: 'error',
    pattern:
      /\b(?:repeat|output|reveal|show|print|display)\b.{0,20}\b(?:system|original|full|entire)\b.{0,20}\b(?:prompt|instructions?|rules?)\b/i,
    message: 'Detected attempt to extract system prompt contents',
  },
  {
    id: 'injection/forget-identity',
    severity: 'error',
    pattern:
      /\bforget\b.{0,15}\b(?:your|all|every|previous)\b.{0,15}\b(?:identity|persona|role|purpose|training)\b/i,
    message: 'Detected attempt to reset agent identity',
  },
  {
    id: 'injection/encoding-evasion-base64',
    severity: 'error',
    pattern:
      /(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9])[A-Za-z0-9+/]{40,}={0,2}/,
    message: 'Detected long base64-encoded string that may hide injection payload',
  },
  {
    id: 'injection/encoding-evasion-hex',
    severity: 'warning',
    pattern: /(?:\\x[0-9a-fA-F]{2}){8,}/,
    message: 'Detected hex-encoded sequence that may hide injection payload',
  },
];

const SAFE_MCP_URL =
  /^https:\/\/(?:[\w-]+\.)*(?:aem\.live|adobeaem\.workers\.dev|adobe\.com|da\.live)\//;

const DATA_URI = /data:[^,]*;base64,/i;

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

const ALLOWED_URL_DOMAINS = [
  'aem.live',
  'aem.page',
  'adobe.com',
  'da.live',
  'adobeaem.workers.dev',
];

function domainAllowed(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_URL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function checkStructural(preset: AgentPreset): LintFinding[] {
  const findings: LintFinding[] = [];

  if (preset.name.length > 100) {
    findings.push({
      id: 'structural/name-too-long',
      severity: 'error',
      message: `name exceeds 100 chars (${preset.name.length})`,
      field: 'name',
    });
  }

  if (preset.description.length > 500) {
    findings.push({
      id: 'structural/description-too-long',
      severity: 'error',
      message: `description exceeds 500 chars (${preset.description.length})`,
      field: 'description',
    });
  }

  if (preset.systemPrompt.length > 4000) {
    findings.push({
      id: 'structural/system-prompt-too-long',
      severity: 'error',
      message: `systemPrompt exceeds 4000 chars (${preset.systemPrompt.length})`,
      field: 'systemPrompt',
    });
  }

  if (preset.skills.length > 20) {
    findings.push({
      id: 'structural/too-many-skills',
      severity: 'error',
      message: `skills array exceeds 20 entries (${preset.skills.length})`,
      field: 'skills',
    });
  }

  if (preset.mcpServers.length > 10) {
    findings.push({
      id: 'structural/too-many-mcp-servers',
      severity: 'error',
      message: `mcpServers array exceeds 10 entries (${preset.mcpServers.length})`,
      field: 'mcpServers',
    });
  }

  if (DATA_URI.test(preset.systemPrompt)) {
    findings.push({
      id: 'structural/data-uri-in-prompt',
      severity: 'error',
      message: 'systemPrompt contains a data: URI (potential encoded payload)',
      field: 'systemPrompt',
    });
  }

  const urls = preset.systemPrompt.match(URL_PATTERN) ?? [];
  for (const url of urls) {
    if (!domainAllowed(url)) {
      findings.push({
        id: 'structural/disallowed-url',
        severity: 'error',
        message: `systemPrompt references disallowed URL: ${truncate(url)}`,
        field: 'systemPrompt',
        match: truncate(url),
      });
    }
  }

  for (const server of preset.mcpServers) {
    if (!SAFE_MCP_URL.test(server)) {
      findings.push({
        id: 'structural/unsafe-mcp-server',
        severity: 'error',
        message: `mcpServers entry is not an allowed HTTPS URL: ${truncate(server)}`,
        field: 'mcpServers',
        match: truncate(server),
      });
    }
  }

  return findings;
}

function checkInjectionPatterns(preset: AgentPreset): LintFinding[] {
  const findings: LintFinding[] = [];
  const fields: Array<{ name: 'systemPrompt' | 'description'; value: string }> = [
    { name: 'systemPrompt', value: preset.systemPrompt },
    { name: 'description', value: preset.description },
  ];

  for (const { name, value } of fields) {
    if (value) {
      for (const rule of INJECTION_PATTERNS) {
        const match = value.match(rule.pattern);
        if (match) {
          findings.push({
            id: rule.id,
            severity: rule.severity,
            message: rule.message,
            field: name,
            match: truncate(match[0]),
          });
        }
      }
    }
  }

  return findings;
}

export function lintPreset(preset: AgentPreset): LintResult {
  const findings = [...checkStructural(preset), ...checkInjectionPatterns(preset)];
  const pass = !findings.some((f) => f.severity === 'error');
  return { pass, findings };
}
