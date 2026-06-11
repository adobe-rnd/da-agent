/**
 * A2A Agent Card for da-agent.
 *
 * Publishes da-agent's capabilities in the A2A protocol format so that
 * AO (and other A2A-compatible orchestrators) can discover and delegate
 * content authoring tasks to da-agent.
 *
 * Spec: https://google.github.io/A2A/#/documentation?id=agent-card
 */

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export function buildAgentCard(baseUrl: string): A2AAgentCard {
  return {
    name: 'DA Content Agent',
    description:
      'Document Authoring (DA) agent for Adobe Experience Manager. ' +
      'Manages content read/write, Edge Delivery Services preview/publish, ' +
      'and live collaborative editing via da-collab.',
    url: `${baseUrl}/a2a/rpc`,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'content-management',
        name: 'Content Management',
        description:
          'Read, create, update, delete, copy, and move content in DA repositories. ' +
          'Supports HTML documents, media files, and structured content.',
      },
      {
        id: 'eds-publishing',
        name: 'Edge Delivery Services Publishing',
        description:
          'Preview and publish content to Adobe Edge Delivery Services (EDS). ' +
          'Manages the content lifecycle from draft to live.',
      },
      {
        id: 'live-editing',
        name: 'Live Collaborative Editing',
        description:
          'Read and update content in real-time via da-collab WebSocket sessions. ' +
          'Supports concurrent editing with other users.',
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  };
}

export function handleAgentCardRequest(requestUrl: string): Response {
  const url = new URL(requestUrl);
  const baseUrl = `${url.protocol}//${url.host}`;

  return new Response(JSON.stringify(buildAgentCard(baseUrl)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
