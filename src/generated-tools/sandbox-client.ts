/**
 * Sandbox client for generated tool execution.
 *
 * This module is the ONLY point inside da-agent that communicates with the
 * generated-tools sandbox Worker. da-agent is the CONTROL PLANE; the
 * sandbox Worker is the EXECUTION PLANE. They are deliberately isolated:
 *
 * - da-agent holds DA Admin credentials, Bedrock tokens, and collab bindings.
 * - The sandbox Worker has NONE of these. It only receives a toolId, tenant
 *   context (org/site), and the sanitized args the model provided.
 * - The sandbox Worker enforces its own capability allowlist and calls the DA
 *   Admin API read-only endpoint directly using a scoped token or public API.
 *
 * PHASE 1 STATUS: The sandbox Worker does not exist yet. This file defines
 * the contract (request/response shape) and provides a feature-flag-guarded
 * stub so the rest of the agent can be wired up without a live sandbox.
 *
 * When the sandbox Worker ships, replace the stub in `callSandbox` with a
 * real `fetch` to env.GENERATED_TOOLS_SANDBOX_URL (or a service binding).
 */

export interface SandboxRequest {
  toolId: string;
  org: string;
  site: string;
  /** Sanitized tool arguments from the model, validated against inputSchema */
  args: Record<string, unknown>;
  /** Forwarded IMS token so the sandbox can call DA Admin on behalf of the user */
  imsToken?: string;
}

export interface SandboxResponse {
  /** Present on success */
  result?: unknown;
  /** Present on error; never throws — always returns an error shape */
  error?: string;
}

/**
 * Execute an approved generated tool in the isolated sandbox Worker.
 *
 * Phase 1 stub: returns a placeholder result so the wiring can be tested
 * end-to-end before the sandbox Worker is deployed.
 *
 * To enable real execution, set env.GENERATED_TOOLS_SANDBOX_URL and the stub
 * check below will be replaced with a live fetch.
 *
 * @param sandboxUrl  The base URL of the sandbox Worker (from env)
 * @param req  Execution request
 */
export async function callSandbox(
  sandboxUrl: string | undefined,
  req: SandboxRequest,
): Promise<SandboxResponse> {
  if (!sandboxUrl) {
    // Phase 1 stub: sandbox Worker not yet deployed.
    // Return a structured placeholder so the model sees a coherent response.
    return {
      result: {
        note:
          `Sandbox execution is not yet available (Phase 1 stub). ` +
          `Tool "${req.toolId}" would run against /${req.org}/${req.site} with args: ${ 
          JSON.stringify(req.args)}`,
      },
    };
  }

  try {
    const resp = await fetch(`${sandboxUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      return { error: `Sandbox returned HTTP ${resp.status}: ${text}` };
    }

    return (await resp.json()) as SandboxResponse;
  } catch (e) {
    return { error: `Sandbox unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
