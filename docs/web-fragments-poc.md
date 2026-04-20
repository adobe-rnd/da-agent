# Web Fragments PoC — Service Worker Architecture

> **Status: Frozen reference.** This document captures the PoC as delivered on
> 2026-04-18. For the productionization roadmap, gap analysis, AEM Content
> Fragment API integration, and IMS token isolation strategies, see
> [web-fragments-productionization.md](web-fragments-productionization.md).

## What we built

A working proof-of-concept that embeds a standalone Astro web application (a restaurant booking form) into an EDS page served by Adobe's CDN, using a **Service Worker as a same-origin proxy** — no Cloudflare Worker gateway required.

### Live demo

- **EDS page (host):** `https://feat-web-fragment-sw--aem-restaurant--anfibiacreativa.aem.page/`
- **Fragment app (standalone):** `https://aem-restaurant-booking.pages.dev/`
- **Shell ↔ fragment communication:** Submit the booking form → a confirmation banner slides in on the host page via BroadcastChannel.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│                                                                  │
│  EDS Page (aem.page)                                             │
│  ├─ web-fragment block decorates                                 │
│  │   ├─ Registers /sw.js                                         │
│  │   ├─ Waits for controllerchange (SW is intercepting)          │
│  │   ├─ Sends fragment config via MessageChannel postMessage     │
│  │   │   { fragmentId, endpoint, routePatterns }                 │
│  │   └─ Creates <web-fragment src="/__wf/booking-app">           │
│  │                                                               │
│  ├─ Service Worker (sw.js)                                       │
│  │   ├─ Receives fragment config via message event               │
│  │   ├─ Intercepts same-origin fetches matching route prefix     │
│  │   ├─ sec-fetch-dest: document → pass through (EDS shell)      │
│  │   ├─ sec-fetch-dest: iframe → return reframed stub            │
│  │   └─ sec-fetch-dest: * → strip prefix, proxy to CF Pages     │
│  │       └─ HTML responses: rewrite /_astro/ → prefix/_astro/    │
│  │                                                               │
│  └─ <web-fragment> element (from web-fragments library)          │
│      ├─ Creates reframed iframe → SW returns stub                │
│      ├─ Fetches fragment HTML → SW proxies to CF Pages           │
│      └─ Injects fragment DOM into host page via reframing        │
│                                                                  │
│  ┌────────────────────────────────────┐                          │
│  │ BroadcastChannel "/reservations"   │                          │
│  │  Fragment posts reservation event  │                          │
│  │  Host page shows confirmation      │                          │
│  │  banner at the top                 │                          │
│  └────────────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────┘
         │
         │ fetch (cross-origin, no custom headers → no preflight)
         ▼
┌──────────────────────────┐
│  Cloudflare Pages        │
│  aem-restaurant-booking  │
│  ├─ / → index.html       │
│  ├─ /_astro/*.css/js     │
│  └─ _headers: CORS *     │
└──────────────────────────┘
```

---

## Repositories involved

| Repo | Branch | What it contains |
|------|--------|------------------|
| `aem-restaurant` | `feat/web-fragment-sw` | EDS site: `sw.js`, `blocks/web-fragment/`, `index.html` |
| `aem-restaurant-booking` | `main` | Astro fragment app deployed to CF Pages |
| `da-agent` | `ew` | Agent skill (`build-web-app.md`), tools (`da_embed_fragment`, `dev_write_files`) |
| `da-nx` | local | DA canvas: `sw.js`, `nx/blocks/web-fragment/` (mirrors aem-restaurant) |
| `web-fragments` (fork) | local only | `npm link`'d locally — cleaned up SW middleware, no changes pushed |

---

## Step-by-step: How we made it work

### 1. Service Worker (`sw.js`)

A plain JS file at the site root — no build step, no imports. Placed at:
- `aem-restaurant/sw.js`
- `da-nx/sw.js`

**Key behaviors:**
- **Fragment registration via `postMessage`**: The block sends `{ type: 'register-fragment', fragmentId, endpoint, routePatterns }` and waits for a `MessageChannel` acknowledgment before proceeding.
- **Route matching**: Normalizes `path-to-regexp` patterns (e.g., `/__wf/booking-app/:_*`) to plain prefix matching.
- **Fetch interception** (same-origin only):
  - `sec-fetch-dest: document` → pass through to EDS origin (the shell page loads normally)
  - `sec-fetch-dest: iframe` → return reframed stub (`<title>Web Fragments: reframed</title>`)
  - Everything else → strip route prefix, proxy to fragment endpoint
- **HTML rewriting**: When proxying HTML responses, rewrites `/_astro/` to `/__wf/{id}/_astro/` so asset requests also route through the SW.
- **No custom headers forwarded**: The proxy `fetch()` doesn't forward `Sec-Fetch-*`, `Origin`, etc. — this avoids CORS preflight requests entirely.
- **Lifecycle**: `skipWaiting()` + `clients.claim()` for immediate activation.

### 2. Web Fragment block (`blocks/web-fragment/`)

EDS block with JS + CSS. The block:

1. **Parses config** from the block's HTML table rows: `fragment-id`, `endpoint`, `routes`
2. **Registers the SW** at `/sw.js` and waits for both:
   - `navigator.serviceWorker.ready` (SW is active)
   - `controllerchange` event (SW is actually intercepting — critical for first-load race condition)
3. **Sends fragment config** via `MessageChannel` + `postMessage`, waits for acknowledgment
4. **Loads web-fragments library** from `esm.sh` (dynamic `<script type="module">` that calls `initializeWebFragments()`)
5. **Creates `<web-fragment>` element** with `src` set to a **same-origin route path** (e.g., `/__wf/booking-app`), NOT the cross-origin endpoint — this is what makes the SW routing work
6. **Listens on BroadcastChannel** for fragment events and displays a confirmation banner on the host page

### 3. Fragment app (Astro)

Standard Astro static site deployed to Cloudflare Pages:
- `astro.config.mjs`: `output: 'static'` with `adapter: cloudflare()` — no `base` or `assetsPrefix` changes needed
- `public/_headers`: Adds `Access-Control-Allow-Origin: *` so the SW's cross-origin `fetch()` can read responses
- `BookingForm.astro`: Posts `{ type: 'reservation_confirmed', booking }` on BroadcastChannel `/reservations` on submit

### 4. DA page content

The fragment is embedded as a standard EDS block in the page HTML:

```html
<div class="web-fragment">
  <div><div>fragment-id</div><div>booking-app</div></div>
  <div><div>endpoint</div><div>https://aem-restaurant-booking.pages.dev</div></div>
  <div><div>routes</div><div>/__wf/booking-app/:_*</div></div>
</div>
```

---

## Problems we solved (and how)

### CORS — cross-origin fetch from SW
**Problem:** The SW's `fetch()` to CF Pages was blocked by CORS preflight.
**Fix:** (a) Don't forward browser-controlled headers (`Sec-Fetch-*`, `Origin`) in the proxy fetch — this eliminates preflight for simple GET requests. (b) Add `public/_headers` with `Access-Control-Allow-Origin: *` to CF Pages so simple CORS responses are readable.

### Same-origin routing
**Problem:** Setting `<web-fragment src="https://cf-pages.dev">` caused the element to fetch directly cross-origin, bypassing the SW entirely.
**Fix:** Set `src` to a same-origin route path (`/__wf/booking-app`) instead of the endpoint URL. The SW intercepts this and proxies to CF Pages.

### Asset path mismatch
**Problem:** Fragment HTML references `/_astro/index.css` (absolute path). The SW only intercepts paths matching `/__wf/booking-app/*`, so `/_astro/*` requests fall through to EDS and 404.
**Fix:** The SW rewrites `/_astro/` → `/__wf/booking-app/_astro/` in proxied HTML responses before returning them. Now asset requests go through the SW.

### Route prefix stripping
**Problem:** The SW was proxying `/__wf/booking-app/styles.css` as-is to CF Pages, which doesn't have files at that path.
**Fix:** Strip the route prefix before proxying: `/__wf/booking-app/styles.css` → `/styles.css` → `https://cf-pages.dev/styles.css`.

### First-load race condition
**Problem:** On first visit, `skipWaiting()` + `clients.claim()` activates the SW, but `clients.claim()` is async. The web-fragment element was created before claim() finished, so its first fetch bypassed the SW.
**Fix:** Wait for the `controllerchange` event (fires after `claim()` completes) before creating the element.

### MessageChannel handshake
**Problem:** `postMessage` to register the fragment is fire-and-forget. The element might fetch before the SW has the config.
**Fix:** Use `MessageChannel` for request-response: the block waits for the SW to `postMessage` back on the port before proceeding.

### Astro `base` config
**Problem:** We tried `base: '/__wf/booking-app'` to prefix asset URLs, but it moved the HTML output location on CF Pages, breaking the proxy.
**Fix:** Reverted `base` to default. Instead, the SW rewrites asset paths in HTML responses (approach above). Astro config stays clean.

---

## da-agent: Tool chain

### Available tools

| Component | Location | Approval | Status |
|-----------|----------|----------|--------|
| `build-web-app.md` skill | `da-agent/skills/build-web-app.md` | — | Updated — no terminal instructions, seamless Lovable-like flow |
| `dev_write_files` tool | `da-agent/src/tools/dev-tools.ts` | Yes | Writes Astro project to disk |
| `deploy_fragment_app` tool | `da-agent/src/tools/dev-tools.ts` | No | Stub — returns pre-deployed CF Pages URL |
| `da_embed_fragment` tool | `da-agent/src/tools/tools.ts` | Yes | Inserts web-fragment block into DA page |
| `content_preview` tool | `da-agent/src/tools/tools.ts` | No | Triggers EDS preview build |

### Tool chain flow (2 user approvals)

The agent chains 4 tools across 3 HTTP requests. `stepCountIs(5)` resets per request, so the chain stays within limits.

**Request 1** (1 step): Agent streams code → `dev_write_files` → pauses for approval
**Request 2** (2 steps): `deploy_fragment_app` → `da_embed_fragment` → pauses for approval
**Request 3** (2 steps): `content_preview` → final text with preview URL

---

## Demo flow (Lovable-style)

### Pre-staged (before demo)
1. Booking app deployed to CF Pages at `https://aem-restaurant-booking.pages.dev/` with `public/_headers` for CORS
2. `aem-restaurant` repo has `sw.js` at root and `blocks/web-fragment/` on `feat/web-fragment-sw`
3. DA page content does NOT have the web-fragment block (agent adds it live)
4. `web-fragments` library is available via `esm.sh`

### What the audience sees

```
1. User opens DA editor on aem-restaurant, navigates to the homepage

2. User asks da-agent:
   "Add an interactive booking form with date, time,
    party size, name, and phone"

3. da-agent streams generated Astro component code in the chat
   (visible — looks like the agent is "coding" in real-time)

4. [Write files] approval card appears → user approves
   (dev_write_files writes the project to disk)

5. Agent says: "Deploying your app..."
   (deploy_fragment_app returns the CF Pages URL instantly)

6. Agent says: "Embedding the booking form into your page..."
   [Embed fragment] approval card appears → user approves
   (da_embed_fragment inserts the web-fragment block into DA page)

7. Agent auto-triggers content_preview (no approval needed)

8. Agent says: "Your booking form is live! Preview it here:
   https://feat-web-fragment-sw--aem-restaurant--anfibiacreativa.aem.page/"

9. User clicks the link → page loads with embedded booking form
   User submits a reservation → confirmation banner slides in on the host page
```

The user never sees a terminal command. Two approvals. Seamless.

---

## Production target (post-PoC)

> **Save this as a prompt/spec for the next phase.**

### Vision

The full production flow eliminates manual terminal steps. The agent handles everything from code generation to deployment, and the user previews the result in the DA wysiwyg editor.

### Production flow

```
1. USER opens DA editor, asks: "Add a booking form to this page"

2. DA-AGENT generates the fragment app code (Astro project)
   → Code streams into a built-in code editor panel
   → The code editor could itself be a web-fragment embedded in the DA canvas
   → User sees the code being generated in real-time

3. DA-AGENT deploys the app:
   a. Creates a GitHub repo (or branch) via GitHub API
   b. Pushes the generated code
   c. Triggers Cloudflare Pages deployment (or GitHub Pages, or Netlify)
   d. Waits for deployment URL to be available

4. DA-AGENT embeds the fragment:
   a. Calls da_embed_fragment with the deployed CF Pages URL
   b. Ensures sw.js exists in the site repo (creates it if not)
   c. Ensures blocks/web-fragment/ exists (creates if not)

5. USER previews in DA wysiwyg:
   a. The DA canvas runs the SW and web-fragment block
   b. The fragment renders inline in the editor
   c. User can interact with it, test it, adjust

6. USER publishes:
   a. Standard EDS preview/publish flow
   b. The fragment is live on the production page

7. USER can iterate:
   a. Ask the agent to modify the fragment code
   b. Agent updates, redeploys
   c. Preview updates in place
```

### Key capabilities needed

| Capability | Status | Notes |
|------------|--------|-------|
| Code generation (Astro/React/Svelte) | **Have** | `build-web-app` skill + `dev_write_files` |
| Code streaming to editor panel | **Need** | Could be a web-fragment in DA canvas |
| GitHub repo creation + push | **Need** | GitHub API via MCP or direct tool |
| CF Pages auto-deploy | **Need** | Wrangler API or CF API tool |
| SW + block auto-scaffolding | **Need** | Agent creates `sw.js` + block if missing |
| DA canvas fragment preview | **Need** | Canvas must run SW + web-fragment block |
| Iterative code updates | **Partial** | `dev_write_files` can overwrite; need redeploy |

### Open questions

1. **Code editor as web-fragment?** Could the live code editor (showing generated code) itself be a web-fragment embedded in the DA canvas? This would demonstrate the composability of the system.

2. **Fragment hosting strategy:** CF Pages per fragment? Single CF Pages project with multiple fragment apps? GitHub Pages? Need to decide the deployment target.

3. **SW bootstrapping:** How does a brand-new EDS site get `sw.js` and the web-fragment block? Options:
   - Agent creates them via `content_update` / `dev_write_files`
   - They're part of a starter template
   - The DA platform injects them automatically

4. **Preview in DA canvas:** The DA wysiwyg editor would need to:
   - Register and run the SW
   - Load the web-fragments library
   - Decorate web-fragment blocks
   - This is a significant integration effort

5. **Fragment app framework:** Currently Astro-only. Should we support React, Svelte, Vue, vanilla? The SW architecture is framework-agnostic — only the code generation skill needs updating.
