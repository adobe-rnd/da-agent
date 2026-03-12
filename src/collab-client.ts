/**
 * CollabClient - Connects to da-collab as the AI Assistant
 *
 * Phase 1: Presence Only
 * - Connects to da-collab via WebSocket
 * - Sets awareness state (purple cursor, "AI Assistant (username)")
 * - (Minimal) Sets awareness cursor at document start
 * - Disconnects after request completes
 *
 * Content edits still go through MCP → da-admin → R2
 */

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

type ActivityState = "connected" | "thinking" | "previewing" | "done";

// Collab server URL - configurable via env
const COLLAB_URL = (globalThis as unknown as Record<string, string>).DA_COLLAB_URL ?? "ws://localhost:4711/http://localhost:8787/source"
// ws://localhost:4711/http://localhost:8787/source/aem-sandbox/block-collection/drafts/mhaack/germany-vacation.html";

export class CollabClient {
  private docPath: string;
  private imsToken: string;
  private userName: string;
  private ydoc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  isConnected = false;
  status: "disconnected" | "connecting" | "connected" | "error" = "disconnected";

  constructor(docPath: string, imsToken: string, userName: string) {
    this.docPath = docPath;
    this.imsToken = imsToken;
    this.userName = userName;
  }

  /**
   * Connect to da-collab and set AI presence
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log(`[CollabClient] Already connected to ${this.docPath}`);
      return;
    }

    console.log(`[CollabClient] Connecting to ${COLLAB_URL} for doc: ${this.docPath}`);
    this.status = "connecting";

    this.ydoc = new Y.Doc();

    const opts = {
      protocols: ["yjs", this.imsToken],
      connect: true
    };

    this.provider = new WebsocketProvider(COLLAB_URL, this.docPath, this.ydoc, opts);

    this.provider.on("status", (event: { status: string }) => {
      console.log(`[CollabClient] Status: ${event.status} for ${this.docPath}`);
    });

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`[CollabClient] Connection timeout for ${this.docPath}`);
        this.isConnected = false;
        resolve();
      }, 5000);

      this.provider!.on("sync", (isSynced: boolean) => {
        if (isSynced) {
          clearTimeout(timeout);
          this.isConnected = true;
          this.status = "connected";
          console.log(`[CollabClient] Synced with da-collab for ${this.docPath}`);
          this.setAwarenessState("connected");
          this.setCursorAtStart();
          resolve();
        }
      });

      this.provider!.on("connection-error", (error: unknown) => {
        clearTimeout(timeout);
        console.error(`[CollabClient] Connection error for ${this.docPath}:`, error);
        this.isConnected = false;
        this.status = "error";
        resolve();
      });
    });
  }

  /**
   * Update AI awareness state (presence + optional cursor)
   * @param activity - Current activity: 'connected' | 'thinking' | 'previewing' | 'done'
   */
  setAwarenessState(activity: ActivityState = "connected"): void {
    if (!this.provider?.awareness) {
      console.warn("[CollabClient] Cannot set awareness - not connected");
      return;
    }

    const state = {
      color: "#9c27b0", // Purple for AI
      name: `AI Assistant (${this.userName})`,
      id: `ai-assistant-${Date.now()}`,
      isAI: true,
      activity
    };

    this.provider.awareness.setLocalStateField("user", state);
    console.log(`[CollabClient] Awareness set: ${state.name} - ${activity}`);
  }

  /**
   * Minimal cursor support: set cursor (anchor/head) to start of the bound Y.XmlFragment.
   * This matches what y-prosemirror's cursor plugin expects: awareness.cursor.{anchor,head}
   * encoded as RelativePosition JSON.
   */
  setCursorAtStart(): void {
    if (!this.provider?.awareness || !this.ydoc) {
      console.warn("[CollabClient] Cannot set cursor - not connected");
      return;
    }

    try {
      const frag = this.ydoc.getXmlFragment("prosemirror");
      const rel = Y.createRelativePositionFromTypeIndex(frag, 0);
      const relJson = Y.relativePositionToJSON(rel);

      this.provider.awareness.setLocalStateField("cursor", {
        anchor: relJson,
        head: relJson
      });

      console.log("[CollabClient] Cursor set to start (fragment: prosemirror)");
    } catch (error) {
      console.warn("[CollabClient] Failed to set cursor at start:", error);
    }
  }

  /**
   * Disconnect from da-collab
   */
  disconnect(): void {
    if (!this.provider) return;

    console.log(`[CollabClient] Disconnecting from ${this.docPath}`);

    if (this.provider.awareness) {
      this.provider.awareness.setLocalState(null);
    }

    this.provider.disconnect();
    this.provider.destroy();
    this.provider = null;

    this.ydoc?.destroy();
    this.ydoc = null;

    this.isConnected = false;
    this.status = "disconnected";
  }
}

/**
 * Factory function to create and connect a CollabClient.
 * Returns null if connection fails (graceful degradation).
 */
export async function createCollabClient(
  docPath: string,
  imsToken: string,
  userName: string
): Promise<CollabClient | null> {
  if (!docPath || !imsToken) {
    console.log("[CollabClient] Missing docPath or imsToken, skipping collab");
    return null;
  }

  try {
    const client = new CollabClient(docPath, imsToken, userName);
    await client.connect();
    return client;
  } catch (error) {
    console.error("[CollabClient] Failed to create client:", error);
    return null;
  }
}
