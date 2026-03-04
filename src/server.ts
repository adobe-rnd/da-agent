import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet
} from "ai";
import { z } from "zod";
import { DAAdminClient } from "./da-admin/client";
import { createDATools } from "./tools/tools";

const PageContextSchema = z.object({
  org: z.string(),
  site: z.string(),
  path: z.string(),
  view: z.string().optional()
});

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ) {
    const pageContextResult = PageContextSchema.safeParse(
      options?.body?.pageContext
    );
    const pageContext = pageContextResult.success
      ? pageContextResult.data
      : undefined;
    const imsToken = options?.body?.imsToken as string | undefined;

    console.log("pageContext:", pageContext);

    const workersai = createWorkersAI({ binding: this.env.AI });

    const daTools = imsToken
      ? createDATools(
          new DAAdminClient({
            apiToken: imsToken,
            daadminService: this.env.DAADMIN
          })
        )
      : {};

    const result = streamText({
      model: workersai("@cf/zai-org/glm-4.7-flash"),
      system: `You are a helpful assistant for Document Authoring (DA) authoring platform.
You help users with questions about DA features, content authoring, and best practices.
Use the available tools to search documentation and provide accurate information.
Always provide helpful, accurate responses. You must never refer to the platform as "Dark Alley" or "DA".

CRITICAL INSTRUCTION - TOOL USAGE:
- NEVER mention tool names in your response text
- NEVER say "I'll use", "Let me call", "using the function", "da_get_source", "da_update_source" or similar
- NEVER explain that you are calling a tool or function
- Simply perform the action and describe the RESULT, not the process
- Bad: "I'll retrieve the content using da_get_source..."
- Good: "Here's the current content of this page:"
- Bad: "Let me update that using da_update_source..."
- Good: "Done! The page now contains..."

${
  pageContext
    ? `

## Current Page Context
The user is currently working on the following document in DA (Document Authoring):
- org: ${pageContext.org}
- site (repo): ${pageContext.site}
- path: ${pageContext.path}
- view: ${pageContext.view}

When making DA tool calls, always use these values:
- org: "${pageContext.org}"
- repo: "${pageContext.site}"
- path: "${pageContext.path}"`
    : ""
}`,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        ...daTools,
        // Approval tool: requires user confirmation before executing
        calculate: tool({
          description:
            "Perform a math calculation with two numbers. Requires user approval for large numbers.",
          inputSchema: z.object({
            a: z.number().describe("First number"),
            b: z.number().describe("Second number"),
            operator: z
              .enum(["+", "-", "*", "/", "%"])
              .describe("Arithmetic operator")
          }),
          needsApproval: async ({ a, b }) =>
            Math.abs(a) > 1000 || Math.abs(b) > 1000,
          execute: async ({ a, b, operator }) => {
            const ops: Record<string, (x: number, y: number) => number> = {
              "+": (x, y) => x + y,
              "-": (x, y) => x - y,
              "*": (x, y) => x * y,
              "/": (x, y) => x / y,
              "%": (x, y) => x % y
            };
            if (operator === "/" && b === 0) {
              return { error: "Division by zero" };
            }
            return {
              expression: `${a} ${operator} ${b}`,
              result: ops[operator](a, b)
            };
          }
        })
      },
      onFinish,
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
