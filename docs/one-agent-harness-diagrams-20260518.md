> Extracted from agent session, 2026-05-18.

# one-agent-harness Architecture Diagrams

Mermaid diagrams derived from ADR-001 (`docs/adr/001-one-agent-harness-architecture.md`).

---

## 1. Component Topology

```mermaid
graph TB
    %% ─── Consumers (Adapters) ───────────────────────────────────
    subgraph Adapters["Adapter Layer"]
        DA["da-agent<br/>(CF Worker)"]
        OAA["one-aem-assistant"]
        SA["Standalone Apps"]
    end

    %% ─── Core Packages ─────────────────────────────────────────
    subgraph Core["one-agent-harness monorepo"]
        subgraph Contracts["@adobe-rnd/one-agent-contracts<br/><i>Pure TS types · zero deps</i>"]
            ISkillStore["SkillStore"]
            IToolProvider["ToolProvider"]
            IToolGov["ToolGovernanceStore"]
            IToolDef["ToolDefinition"]
            IPromptSection["PromptSection"]
            IMsgTypes["Message Types"]
            IStreamModel["StreamingModel"]
        end

        subgraph Harness["@adobe-rnd/one-agent-harness<br/><i>Zod · @opentelemetry/api</i>"]
            Parse["Parse Request"]
            Context["Build Context"]
            SkillRes["Resolve Skills"]
            ToolAsm["Assemble Tools"]
            PromptBld["Compose Prompt"]
            Stream["Multi-Step Stream"]
            Teardown["Teardown"]
            Approval["Tool Approval Protocol"]
            OTel["OTel Instrumentation"]
        end

        subgraph MCP["@adobe-rnd/one-agent-mcp<br/><i>@modelcontextprotocol/sdk</i>"]
            MCPProv["createMCPProvider()"]
        end
    end

    %% ─── External ───────────────────────────────────────────────
    subgraph External["External Systems"]
        Bedrock["AWS Bedrock<br/>(Claude)"]
        MCPServers["MCP Servers"]
        DAAdmin["da-admin API"]
        EDS["EDS Admin"]
        Collab["da-collab (Yjs)"]
    end

    subgraph Frontend["Frontend"]
        DANX["da-nx<br/>chat-controller.js"]
    end

    %% ─── Relationships ──────────────────────────────────────────
    DA --> Harness
    OAA --> Harness
    SA --> Harness

    DA -.->|"types"| Contracts
    OAA -.->|"types"| Contracts
    SA -.->|"types"| Contracts

    Harness -->|"implements"| Contracts
    MCP -->|"implements"| IToolProvider

    %% Lifecycle flow
    Parse --> Context --> SkillRes --> ToolAsm --> PromptBld --> Stream --> Teardown

    %% Tool approval is a sub-loop within Stream
    Stream -->|"requiresApproval"| Approval
    Approval -->|"resume"| Stream

    %% Adapter-provided implementations
    DA -->|"SkillStore impl"| ISkillStore
    DA -->|"ToolProvider impls"| IToolProvider
    DA -->|"GovernanceStore impl"| IToolGov
    DA -->|"PromptSections"| IPromptSection

    %% Model adapter
    Harness -->|"StreamingModel"| Bedrock

    %% MCP plugin
    MCPProv --> MCPServers

    %% DA-specific externals
    DA --> DAAdmin
    DA --> EDS
    DA --> Collab

    %% Wire protocol
    Stream -->|"SSE wire protocol"| DANX

    %% Telemetry
    OTel -.->|"spans"| Langfuse["Langfuse / Datadog / Jaeger"]
```

---

## 2. Request Lifecycle (Sequence)

```mermaid
sequenceDiagram
    participant FE as da-nx Frontend
    participant H as Harness
    participant SS as SkillStore
    participant TP as ToolProviders
    participant PB as PromptBuilder
    participant M as StreamingModel (Bedrock)
    participant T as Tool

    FE->>H: POST /chat (messages, pageContext, imsToken)
    activate H

    Note over H: Parse & validate (Zod)

    H->>SS: loadIndex(org, site)
    SS-->>H: SkillsIndex
    H->>SS: loadContent(org, site, id)
    SS-->>H: skill body

    H->>TP: connect() [all providers]
    TP-->>H: ready

    H->>PB: compose(sections, context)
    PB-->>H: system prompt

    loop Multi-step (max N)
        H->>M: stream(messages, tools, prompt)
        M-->>H: text-delta / tool-call events

        alt Tool requires approval
            H-->>FE: SSE: tool-approval-request
            FE->>H: tool-approval-response (approved)
        end

        alt Tool call
            H->>T: execute(args, context)
            T-->>H: result
            H-->>FE: SSE: tool-result
        end

        H-->>FE: SSE: text-delta (streaming)
    end

    H-->>FE: SSE: finish-message

    H->>TP: dispose() [all providers, via finally]
    deactivate H
```

---

## 3. Package Dependency Graph

```mermaid
graph LR
    subgraph "npm packages"
        C["@adobe-rnd/<br/>one-agent-contracts<br/><i>0 deps</i>"]
        H["@adobe-rnd/<br/>one-agent-harness<br/><i>zod, @opentelemetry/api</i>"]
        MCP["@adobe-rnd/<br/>one-agent-mcp<br/><i>@modelcontextprotocol/sdk</i>"]
    end

    H -->|"imports types"| C
    MCP -->|"imports types"| C
    MCP -.->|"optional plugin for"| H

    DA["da-agent"] -->|"depends on"| H
    DA -->|"depends on"| C
    DA -->|"optionally"| MCP

    OAA["one-aem-assistant"] -->|"depends on"| H
    OAA -->|"depends on"| C
```
