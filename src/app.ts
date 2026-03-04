import { LitElement, html } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { AgentClient, agentFetch } from "agents/client";
import {
  AbstractChat,
  type ChatState,
  type ChatStatus,
  type UIMessage
} from "ai";
import { getToolName, isToolUIPart } from "ai";
import { MessageType, type OutgoingMessage } from "@cloudflare/ai-chat/types";

const AGENT_NAME = "ChatAgent";

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownLite(text: string) {
  const parts = text.split(/```/g);
  const out: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i] ?? "";
    if (i % 2 === 1) {
      const lines = chunk.split("\n");
      const lang = lines[0]?.trim();
      const code = lines.slice(1).join("\n");
      out.push(
        `<pre class=\"code\"><code class=\"${
          lang ? `lang-${escapeHtml(lang)}` : ""
        }\">${escapeHtml(code)}</code></pre>`
      );
    } else {
      out.push(escapeHtml(chunk).replace(/\n/g, "<br>"));
    }
  }

  return out.join("");
}

function safeClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

class ChatController {
  private agent: AgentClient;
  private chat: LitChat;
  private localRequestIds = new Set<string>();
  private onUpdate: () => void;
  private onStatusChange: (status: ChatStatus) => void;
  private onConnectionChange: (connected: boolean) => void;
  private onToast: (toast: Toast) => void;
  private host: string;

  messages: UIMessage[] = [];
  status: ChatStatus = "ready";

  constructor(options: {
    onUpdate: () => void;
    onStatusChange: (status: ChatStatus) => void;
    onConnectionChange: (connected: boolean) => void;
    onToast: (toast: Toast) => void;
  }) {
    this.onUpdate = options.onUpdate;
    this.onStatusChange = options.onStatusChange;
    this.onConnectionChange = options.onConnectionChange;
    this.onToast = options.onToast;

    this.host = window.location.host;
    this.agent = new AgentClient({ agent: AGENT_NAME, host: this.host });
    this.agent.addEventListener("open", () => {
      this.onConnectionChange(true);
    });
    this.agent.addEventListener("close", () => {
      this.onConnectionChange(false);
    });

    this.agent.addEventListener("message", (event) => {
      this.handleAgentMessage(event);
    });

    const state = this.createState();
    this.chat = new LitChat({
      state,
      transport: new AgentChatTransport({
        agent: this.agent,
        activeRequestIds: this.localRequestIds
      }),
      onToolCall: async ({ toolCall }) => {
        if (toolCall.toolName === "getUserTimezone") {
          const output = {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString()
          };
          this.addToolOutput({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output
          });
        }
      },
      onStatusChange: (status) => {
        this.status = status;
        this.onStatusChange(status);
      }
    });

    void this.loadInitialMessages();
  }

  private createState(): ChatState<UIMessage> {
    const state: ChatState<UIMessage> = {
      status: "ready",
      error: undefined,
      messages: [],
      pushMessage: (message) => {
        state.messages = [...state.messages, message];
        this.messages = state.messages;
        this.onUpdate();
      },
      popMessage: () => {
        state.messages = state.messages.slice(0, -1);
        this.messages = state.messages;
        this.onUpdate();
      },
      replaceMessage: (index, message) => {
        const next = [...state.messages];
        next[index] = message;
        state.messages = next;
        this.messages = state.messages;
        this.onUpdate();
      },
      snapshot: (value) => safeClone(value)
    };

    return state;
  }

  private async loadInitialMessages() {
    try {
      const response = await agentFetch(
        { agent: AGENT_NAME, host: this.host, path: "get-messages" },
        { method: "GET", headers: { "content-type": "application/json" } }
      );
      if (!response.ok) return;
      const text = await response.text();
      if (!text.trim()) return;
      const messages = JSON.parse(text) as UIMessage[];
      this.messages = messages;
      this.chat.messages = messages;
      this.onUpdate();
    } catch {
      // Ignore initial load errors; the connection still works.
    }
  }

  private handleAgentMessage(event: MessageEvent) {
    if (typeof event.data !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    if (!("type" in parsed)) return;

    const data = parsed as Record<string, unknown>;
    const type = data.type;
    if (typeof type !== "string") return;

    if (type === "scheduled-task") {
      const payload = data as { description?: unknown };
      this.onToast({
        id: crypto.randomUUID(),
        title: "Scheduled task completed",
        description:
          typeof payload.description === "string"
            ? payload.description
            : "Task completed"
      });
      return;
    }

    switch (type) {
      case MessageType.CF_AGENT_CHAT_CLEAR:
        this.messages = [];
        this.chat.messages = [];
        this.onUpdate();
        break;
      case MessageType.CF_AGENT_CHAT_MESSAGES:
        if (!Array.isArray(data.messages)) return;
        this.messages = data.messages as UIMessage[];
        this.chat.messages = this.messages;
        this.onUpdate();
        break;
      case MessageType.CF_AGENT_MESSAGE_UPDATED:
        if (!data.message) return;
        this.updateMessageFromServer(data.message as UIMessage);
        break;
      case MessageType.CF_AGENT_USE_CHAT_RESPONSE:
        // Ignore streaming messages from other tabs to keep this client simple.
        // Local streaming is handled by AgentChatTransport.
        if (typeof data.id !== "string") return;
        if (this.localRequestIds.has(data.id)) return;
        break;
      default:
        break;
    }
  }

  private updateMessageFromServer(updatedMessage: UIMessage) {
    const idx = this.messages.findIndex((m) => m.id === updatedMessage.id);
    if (idx >= 0) {
      const next = [...this.messages];
      next[idx] = { ...updatedMessage, id: this.messages[idx].id };
      this.messages = next;
      this.chat.messages = next;
      this.onUpdate();
      return;
    }

    const updatedToolCallIds = new Set(
      updatedMessage.parts
        .filter(
          (p) => "toolCallId" in p && (p as { toolCallId?: string }).toolCallId
        )
        .map((p) => (p as { toolCallId: string }).toolCallId)
    );

    if (updatedToolCallIds.size > 0) {
      const matchIndex = this.messages.findIndex((m) =>
        m.parts.some(
          (p) =>
            "toolCallId" in p &&
            updatedToolCallIds.has((p as { toolCallId: string }).toolCallId)
        )
      );
      if (matchIndex >= 0) {
        const next = [...this.messages];
        next[matchIndex] = {
          ...updatedMessage,
          id: this.messages[matchIndex].id
        };
        this.messages = next;
        this.chat.messages = next;
        this.onUpdate();
        return;
      }
    }

    this.messages = [...this.messages, updatedMessage];
    this.chat.messages = this.messages;
    this.onUpdate();
  }

  get connected() {
    return this.agent.ready !== undefined;
  }

  get statusLabel() {
    return this.chat.status;
  }

  async sendMessage(text: string) {
    await this.chat.sendMessage({ text });
    this.status = this.chat.status;
    this.onUpdate();
  }

  stop() {
    void this.chat.stop();
  }

  clearHistory() {
    this.messages = [];
    this.chat.messages = [];
    this.agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_CHAT_CLEAR
      })
    );
    this.onUpdate();
  }

  addToolOutput(options: {
    toolCallId: string;
    toolName?: string;
    output: unknown;
  }) {
    const toolName = options.toolName ?? "";
    this.agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_RESULT,
        toolCallId: options.toolCallId,
        toolName,
        output: options.output,
        autoContinue: true
      })
    );

    void this.chat.addToolOutput({
      tool: toolName as never,
      toolCallId: options.toolCallId,
      output: options.output as never
    });
  }

  addToolApprovalResponse(options: { id: string; approved: boolean }) {
    const toolCallId = this.findToolCallIdByApprovalId(options.id);
    if (toolCallId) {
      this.agent.send(
        JSON.stringify({
          type: MessageType.CF_AGENT_TOOL_APPROVAL,
          toolCallId,
          approved: options.approved,
          autoContinue: true
        })
      );
    }

    void this.chat.addToolApprovalResponse({
      id: options.id,
      approved: options.approved
    });
  }

  private findToolCallIdByApprovalId(approvalId: string) {
    for (const msg of this.messages) {
      for (const part of msg.parts) {
        if (
          "toolCallId" in part &&
          "approval" in part &&
          (part.approval as { id?: string })?.id === approvalId
        ) {
          return part.toolCallId as string;
        }
      }
    }
    return undefined;
  }
}

class LitChat extends AbstractChat<UIMessage> {
  private onStatusChange?: (status: ChatStatus) => void;

  constructor(options: {
    state: ChatState<UIMessage>;
    transport: AgentChatTransport;
    onToolCall: ({
      toolCall
    }: {
      toolCall: { toolCallId: string; toolName: string; input: unknown };
    }) => void | Promise<void>;
    onStatusChange?: (status: ChatStatus) => void;
  }) {
    super({
      state: options.state,
      transport: options.transport,
      onToolCall: options.onToolCall
    });
    this.onStatusChange = options.onStatusChange;
  }

  protected setStatus({
    status,
    error
  }: {
    status: ChatStatus;
    error?: Error;
  }) {
    super.setStatus({ status, error });
    this.onStatusChange?.(status);
  }
}

class AgentChatTransport {
  private agent: AgentClient;
  private activeRequestIds?: Set<string>;

  constructor(options: { agent: AgentClient; activeRequestIds?: Set<string> }) {
    this.agent = options.agent;
    this.activeRequestIds = options.activeRequestIds;
  }

  async sendMessages(options: {
    chatId: string;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    trigger: "submit-message" | "regenerate-message";
    messageId?: string;
    body?: object;
    headers?: Record<string, string> | Headers;
    metadata?: unknown;
  }): Promise<ReadableStream<import("ai").UIMessageChunk>> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const abortController = new AbortController();
    let completed = false;

    this.activeRequestIds?.add(requestId);

    options.abortSignal?.addEventListener("abort", () => {
      if (completed) return;
      this.agent.send(
        JSON.stringify({
          id: requestId,
          type: MessageType.CF_AGENT_CHAT_REQUEST_CANCEL
        })
      );
      this.activeRequestIds?.delete(requestId);
      abortController.abort();
    });

    const stream = new ReadableStream<import("ai").UIMessageChunk>({
      start: (controller) => {
        const onMessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(
              event.data as string
            ) as OutgoingMessage<UIMessage>;

            if (data.type !== MessageType.CF_AGENT_USE_CHAT_RESPONSE) return;
            if (data.id !== requestId) return;

            if (data.error) {
              completed = true;
              controller.error(new Error(data.body));
              this.activeRequestIds?.delete(requestId);
              abortController.abort();
              return;
            }

            if (data.body?.trim()) {
              try {
                const chunk = JSON.parse(
                  data.body
                ) as import("ai").UIMessageChunk;
                controller.enqueue(chunk);
              } catch {
                // Skip malformed chunks
              }
            }

            if (data.done) {
              completed = true;
              try {
                controller.close();
              } catch {
                // Ignore
              }
              this.activeRequestIds?.delete(requestId);
              abortController.abort();
            }
          } catch {
            // Ignore
          }
        };

        this.agent.addEventListener("message", onMessage, {
          signal: abortController.signal
        });
      },
      cancel: () => {
        abortController.abort();
      }
    });

    const bodyPayload = JSON.stringify({
      messages: options.messages
    });

    this.agent.send(
      JSON.stringify({
        id: requestId,
        init: {
          method: "POST",
          body: bodyPayload
        },
        type: MessageType.CF_AGENT_USE_CHAT_REQUEST
      })
    );

    return stream;
  }

  async reconnectToStream(): Promise<ReadableStream<
    import("ai").UIMessageChunk
  > | null> {
    return null;
  }
}

type Toast = {
  id: string;
  title: string;
  description?: string;
};

class AgentApp extends LitElement {
  static properties = {
    connected: { state: true },
    input: { state: true },
    showDebug: { state: true },
    messages: { state: true },
    streaming: { state: true },
    toasts: { state: true }
  };

  connected: boolean = false;
  input: string = "";
  showDebug: boolean = false;
  messages: UIMessage[] = [];
  streaming: boolean = false;
  toasts: Toast[] = [];

  private controller: ChatController;
  private textarea?: HTMLTextAreaElement;
  private endRef = createRef<HTMLDivElement>();

  constructor() {
    super();
    this.controller = new ChatController({
      onUpdate: () => {
        this.messages = [...this.controller.messages];
        this.streaming =
          this.controller.statusLabel === "streaming" ||
          this.controller.statusLabel === "submitted";
        this.requestUpdate();
      },
      onStatusChange: () => {
        this.streaming =
          this.controller.statusLabel === "streaming" ||
          this.controller.statusLabel === "submitted";
        this.requestUpdate();
      },
      onConnectionChange: (connected) => {
        this.connected = connected;
        this.requestUpdate();
      },
      onToast: (toast) => {
        this.toasts = [toast, ...this.toasts];
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.textarea = this.renderRoot.querySelector("textarea") ?? undefined;
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("messages") || changed.has("streaming")) {
      this.endRef.value?.scrollIntoView({ behavior: "smooth" });
    }
  }

  private toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-mode") === "dark"
        ? "dark"
        : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-mode", next);
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("theme", next);
    this.requestUpdate();
  }

  private async send() {
    const text = this.input.trim();
    if (!text || this.streaming) return;
    this.input = "";
    this.requestUpdate();
    await this.controller.sendMessage(text);
    if (this.textarea) {
      this.textarea.style.height = "auto";
    }
  }

  private renderToolPart(part: UIMessage["parts"][number]) {
    if (!isToolUIPart(part)) return null;
    const toolName = getToolName(part);

    if (part.state === "output-available") {
      return html`<div class="tool-card">
        <div class="tool-header">
          <span class="tool-icon">⚙</span>
          <span class="tool-name">${toolName}</span>
          <span class="tool-badge done">Done</span>
        </div>
        <pre>${JSON.stringify(part.output, null, 2)}</pre>
      </div>`;
    }

    if ("approval" in part && part.state === "approval-requested") {
      const approvalId = (part.approval as { id?: string })?.id;
      return html`<div class="tool-card warning">
        <div class="tool-header">
          <span class="tool-icon">⚙</span>
          <span class="tool-name">Approval needed: ${toolName}</span>
        </div>
        <pre>${JSON.stringify(part.input, null, 2)}</pre>
        <div class="tool-actions">
          <button
            class="btn primary"
            ?disabled=${!approvalId}
            @click=${() => {
              if (approvalId) {
                this.controller.addToolApprovalResponse({
                  id: approvalId,
                  approved: true
                });
              }
            }}
          >
            Approve
          </button>
          <button
            class="btn ghost"
            ?disabled=${!approvalId}
            @click=${() => {
              if (approvalId) {
                this.controller.addToolApprovalResponse({
                  id: approvalId,
                  approved: false
                });
              }
            }}
          >
            Reject
          </button>
        </div>
      </div>`;
    }

    if (
      part.state === "output-denied" ||
      ("approval" in part &&
        (part.approval as { approved?: boolean })?.approved === false)
    ) {
      return html`<div class="tool-card">
        <div class="tool-header">
          <span class="tool-icon">✕</span>
          <span class="tool-name">${toolName}</span>
          <span class="tool-badge rejected">Rejected</span>
        </div>
      </div>`;
    }

    if (part.state === "input-available" || part.state === "input-streaming") {
      return html`<div class="tool-card">
        <div class="tool-header">
          <span class="tool-icon spinning">⚙</span>
          <span class="tool-name">Running ${toolName}...</span>
        </div>
      </div>`;
    }

    return null;
  }

  private renderMessageText(text: string, isUser: boolean) {
    const content = renderMarkdownLite(text);
    return html`<div class=${isUser ? "bubble user" : "bubble assistant"}>${unsafeHTML(content)}</div>`;
  }

  private renderReasoning(part: {
    text: string;
    state?: "streaming" | "done";
  }) {
    if (!part.text?.trim()) return null;
    const done = part.state === "done" || !this.streaming;
    return html`<details class="reasoning" ?open=${!done}>
      <summary>
        <span>Reasoning</span>
        <span class=${done ? "status done" : "status thinking"}>${done ? "Complete" : "Thinking..."}</span>
      </summary>
      <pre>${part.text}</pre>
    </details>`;
  }

  private renderEmptyState() {
    const prompts = [
      "What's the weather in Paris?",
      "What timezone am I in?",
      "Calculate 5000 * 3",
      "Remind me in 5 minutes to take a break"
    ];

    return html`<div class="empty">
      <div class="empty-title">Start a conversation</div>
      <div class="empty-actions">
        ${prompts.map(
          (prompt) => html`<button
            class="btn ghost"
            ?disabled=${this.streaming}
            @click=${() => {
              void this.controller.sendMessage(prompt);
            }}
          >
            ${prompt}
          </button>`
        )}
      </div>
    </div>`;
  }

  private renderToasts() {
    return html`<div class="toast-stack">
      ${this.toasts.map(
        (toast) => html`<div class="toast" key=${toast.id}>
          <div class="toast-title">${toast.title}</div>
          ${toast.description ? html`<div class="toast-desc">${toast.description}</div>` : null}
          <button
            class="toast-close"
            @click=${() => {
              this.toasts = this.toasts.filter((t) => t.id !== toast.id);
            }}
          >
            ×
          </button>
        </div>`
      )}
    </div>`;
  }

  render() {
    return html`
      <div class="app">
        ${this.renderToasts()}
        <header class="app-header">
          <div class="brand">
            <span class="brand-icon">
              <img src="/aec.svg" alt="Adobe Experience Cloud" style="width:1.6em;height:1.6em;color: red;" />
            </span>
            <span>DA Agent</span>
            <span class="chip">AI Assistant</span>
          </div>
          <div class="header-actions">
            <div class="status">
              <span class=${this.connected ? "dot ok" : "dot bad"}></span>
              <span>${this.connected ? "Connected" : "Disconnected"}</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                ?checked=${this.showDebug}
                @change=${(event: Event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  this.showDebug = target.checked;
                }}
              />
              <span>Debug</span>
            </label>
            <button class="btn ghost" @click=${() => this.toggleTheme()} title="Toggle theme">
              Theme
            </button>
            <button class="btn ghost" @click=${() => this.controller.clearHistory()}>
              Clear
            </button>
          </div>
        </header>

        <main class="messages">
          <div class="messages-inner">
            ${this.messages.length === 0 ? this.renderEmptyState() : null}
            ${this.messages.map((message, index) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                message.role === "assistant" &&
                index === this.messages.length - 1;

              return html`<div class="message-group">
                ${
                  this.showDebug
                    ? html`<pre class="debug">${JSON.stringify(message, null, 2)}</pre>`
                    : null
                }

                ${message.parts.filter(isToolUIPart).map((part) => this.renderToolPart(part))}

                ${message.parts
                  .filter(
                    (part) =>
                      part.type === "reasoning" &&
                      (part as { text?: string }).text?.trim()
                  )
                  .map((part) =>
                    this.renderReasoning(
                      part as { text: string; state?: "streaming" | "done" }
                    )
                  )}

                ${message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => {
                    const text = (part as { text?: string }).text ?? "";
                    if (!text) return null;
                    return html`<div class="message-row ${isUser ? "user" : "assistant"}">
                      ${this.renderMessageText(text, isUser)}
                      ${
                        isLastAssistant && this.streaming && !isUser
                          ? html`
                              <span class="typing">▍</span>
                            `
                          : null
                      }
                    </div>`;
                  })}
              </div>`;
            })}
            <div class="messages-end" ${ref(this.endRef)}></div>
          </div>
        </main>

        <footer class="composer">
          <form
            @submit=${(event: Event) => {
              event.preventDefault();
              void this.send();
            }}
          >
            <div class="composer-inner">
              <textarea
                .value=${this.input}
                placeholder="Send a message..."
                ?disabled=${!this.connected || this.streaming}
                rows="1"
                @input=${(event: Event) => {
                  const target = event.currentTarget as HTMLTextAreaElement;
                  this.input = target.value;
                  target.style.height = "auto";
                  target.style.height = `${target.scrollHeight}px`;
                }}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void this.send();
                  }
                }}
              ></textarea>
              ${
                this.streaming
                  ? html`<button type="button" class="btn ghost" @click=${() => this.controller.stop()}>
                    Stop
                  </button>`
                  : html`<button
                    type="submit"
                    class="btn primary"
                    ?disabled=${!this.input.trim() || !this.connected}
                  >
                    Send
                  </button>`
              }
            </div>
          </form>
        </footer>
      </div>
    `;
  }
}

customElements.define("agent-app", AgentApp);
