/**
 * Built-in tool catalog — derives tool names and descriptions from the actual
 * tool registrations so the endpoint stays in sync automatically.
 */

import { createDATools, createCanvasClientTools, createEDSTools } from './tools.js';

interface CatalogTool {
  name: string;
  description: string;
}

interface CatalogServer {
  id: string;
  description: string;
  transport: string;
  tools: CatalogTool[];
}

export interface BuiltinToolCatalog {
  servers: CatalogServer[];
}

function shortDescription(full: string): string {
  const firstSentence = full.match(/^[^.!]+[.!]/)?.[0];
  return firstSentence ?? full.slice(0, 120);
}

function extractToolMeta(tools: Record<string, unknown>): CatalogTool[] {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: shortDescription((def as { description?: string }).description ?? name),
  }));
}

const DUMMY_CLIENT = new Proxy({}, { get: () => () => Promise.resolve(null) });

let cached: BuiltinToolCatalog | null = null;

export function getBuiltinToolCatalog(): BuiltinToolCatalog {
  if (cached) return cached;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const daTools = createDATools(DUMMY_CLIENT as any);
  const canvasTools = createCanvasClientTools();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edsTools = createEDSTools(DUMMY_CLIENT as any);

  cached = {
    servers: [
      {
        id: 'da-tools',
        description: 'Core DA authoring tools — read, write, list, copy, and manage content',
        transport: 'built-in',
        tools: [...extractToolMeta(daTools), ...extractToolMeta(canvasTools)],
      },
      {
        id: 'eds-preview',
        description: 'Preview and publish content to Edge Delivery Services',
        transport: 'built-in',
        tools: extractToolMeta(edsTools),
      },
    ],
  };

  return cached;
}
