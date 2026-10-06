// src/telemetry.ts
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { LangfuseExporter } from 'langfuse-vercel';

const DEFAULT_LANGFUSE_BASEURL =
  'https://mystique-langfuse-prod.corp.ethos117-prod-va6.ethos.adobe.net/';
const TELEMETRY_FUNCTION_ID = 'da-agent-chat';
const MAX_LIST_VALUES = 12;

type TelemetryMetadata = Record<string, string | number | boolean | string[]>;

export interface ChatTelemetryInput {
  userId?: string | null;
  sessionId?: string | null;
  org?: string | null;
  site?: string | null;
  path?: string | null;
  view?: string | null;
  environment?: string | null;
  agentId?: string | null;
  requestedSkills?: string[] | null;
  toolNames?: string[] | null;
  attachmentCount?: number;
  mcpServerCount?: number;
  builtInServerCount?: number;
  generatedToolCount?: number;
  autoCompact?: boolean;
}

let initialized = false;
let exporter: LangfuseExporter | null = null;

function uniqSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort();
}

function deriveEntryPoint(agentId?: string | null, requestedSkills?: string[] | null): string {
  if (agentId) return 'agent';
  if ((requestedSkills?.length ?? 0) > 0) return 'skills';
  return 'chat';
}

function derivePrimarySkill(requestedSkills?: string[] | null): string {
  return uniqSorted(requestedSkills ?? []).at(0) ?? 'none';
}

function limitList(values: string[] | null | undefined): string[] {
  return uniqSorted(values ?? []).slice(0, MAX_LIST_VALUES);
}

export function telemetryEnabled(
  env: Pick<Env, 'LANGFUSE_PUBLIC_KEY' | 'LANGFUSE_SECRET_KEY'>,
): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

export function buildChatTelemetryMetadata(input: ChatTelemetryInput): TelemetryMetadata {
  const requestedSkills = limitList(input.requestedSkills);
  const toolNames = limitList(input.toolNames);
  const entryPoint = deriveEntryPoint(input.agentId, requestedSkills);

  return {
    userId: input.userId ?? 'unknown',
    org: input.org ?? 'unknown',
    site: input.site ?? 'unknown',
    path: input.path ?? 'unknown',
    sessionId: input.sessionId ?? 'unknown',
    telemetryVersion: 2,
    functionId: TELEMETRY_FUNCTION_ID,
    environment: input.environment ?? 'unknown',
    view: input.view ?? 'unknown',
    entryPoint,
    primarySkill: derivePrimarySkill(requestedSkills),
    skillCount: requestedSkills.length,
    requestedSkills,
    agentId: input.agentId ?? 'none',
    toolCount: toolNames.length,
    toolNames,
    attachmentCount: input.attachmentCount ?? 0,
    mcpServerCount: input.mcpServerCount ?? 0,
    builtInServerCount: input.builtInServerCount ?? 0,
    generatedToolCount: input.generatedToolCount ?? 0,
    autoCompact: input.autoCompact ?? false,
    hasPageContext: Boolean(input.org || input.site || input.path),
  };
}

export function getChatTelemetryFunctionId(): string {
  return TELEMETRY_FUNCTION_ID;
}

export function initTelemetry(env: Env): void {
  if (initialized) return;

  if (!telemetryEnabled(env)) {
    console.warn(
      'Telemetry: LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set, skipping telemetry setup',
    );
    return;
  }

  exporter = new LangfuseExporter({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASEURL || DEFAULT_LANGFUSE_BASEURL,
  });

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);

  initialized = true;
}

export async function flushTelemetry(): Promise<void> {
  if (exporter) {
    try {
      await exporter.forceFlush();
    } catch (e) {
      console.error('Telemetry: failed to flush spans:', e);
    }
  }
}
