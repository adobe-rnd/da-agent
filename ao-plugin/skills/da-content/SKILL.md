---
name: da-content-delegation
description: Delegates document authoring tasks to the DA Content Agent via A2A protocol, and provides guidance on using DA MCP tools directly
metadata:
  lifecycle: stable
  dependencies: []
---

# DA Content Delegation

Use this skill when the user needs to perform document authoring tasks in Adobe Experience Manager's Document Authoring (DA) system.

## Available MCP tools

### EDS Publishing (da-publish MCP server)

These tools are available directly via the `da-publish` MCP server:

- **content_preview** — trigger a preview build for a page on EDS
- **content_publish** — preview then publish a page to EDS live
- **content_unpreview** — remove a page from the EDS preview environment
- **content_unpublish** — unpublish a page from the EDS live environment

Each tool takes `org`, `repo`, and `path` parameters.

### DA Content Management (via A2A delegation)

For content CRUD operations, delegate to the DA Content Agent via the `agent_task` tool targeting `da-content-agent`:

- **Read or browse content** in a DA repository (organizations and sites)
- **Create, update, or delete** pages, documents, or media files
- **Copy or move** content within a repository
- **Version management** — create snapshots and list version history
- **Media and fragments** — look up media assets and content fragments
- **Skills and agents** — read skills, create skills, list and create agent presets
- **Project memory** — write long-lived project context for a site

## When to delegate vs use MCP directly

| Task | Approach |
|------|----------|
| Preview or publish pages | Use `da-publish` MCP tools directly |
| Read, create, update, delete content | Delegate to DA Content Agent (A2A) |
| Upload media or manage versions | Delegate to DA Content Agent (A2A) |
| Live collaborative editing | Delegate to DA Content Agent (A2A) |

## Example delegations

- "Update the hero section on the frescopa homepage" → delegate to DA Content Agent
- "Publish the latest draft of the product page" → use `content_publish` MCP tool
- "List all pages under /blog in the acme site" → delegate to DA Content Agent
- "Preview this page before we go live" → use `content_preview` MCP tool
