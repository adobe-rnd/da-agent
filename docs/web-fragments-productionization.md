# Web Fragments — Productionization Roadmap

> **Audience:** next engineer or agent continuing this work.
> **Prerequisite reading:** [web-fragments-poc.md](web-fragments-poc.md) (frozen PoC reference).

---

## Part 0 — What the PoC Proved

A **Service Worker acting as a same-origin proxy** can embed a standalone
web application (Astro, but framework-agnostic) inside an Adobe Edge Delivery
Services (EDS) page with **no Cloudflare Worker gateway**. The reference
implementation is a restaurant booking form.

### Architecture (proven in PoC)

```
                          Browser
 ┌──────────────────────────────────────────────────────────────┐
 │  EDS Page (aem.page)                                        │
 │  ├─ web-fragment block                                      │
 │  │   ├─ registers /sw.js                                    │
 │  │   ├─ waits for controllerchange                          │
 │  │   ├─ sends fragment config via MessageChannel             │
 │  │   └─ creates <web-fragment src="/__wf/booking-app">      │
 │  │                                                          │
 │  ├─ Service Worker (sw.js)                                  │
 │  │   ├─ receives config via message event                   │
 │  │   ├─ intercepts same-origin fetches matching prefix      │
 │  │   ├─ sec-fetch-dest: document → pass through             │
 │  │   ├─ sec-fetch-dest: iframe  → reframed stub             │
 │  │   └─ everything else → strip prefix, proxy to endpoint   │
 │  │       └─ HTML: rewrite /_astro/ → prefix/_astro/         │
 │  │                                                          │
 │  ├─ <web-fragment> element (web-fragments library)          │
 │  │   └─ reframed iframe → DOM injected into host page       │
 │  │                                                          │
 │  └─ BroadcastChannel "/reservations"                        │
 │      fragment posts event → host shows banner               │
 └──────────────────────────────────────────────────────────────┘
          │  fetch (no custom headers → no preflight)
          ▼
 ┌────────────────────────┐
 │  Cloudflare Pages      │
 │  aem-restaurant-booking│
 │  ├─ index.html         │
 │  ├─ /_astro/*.css/js   │
 │  └─ _headers: CORS *   │
 └────────────────────────┘
```

### Inventory — real vs. stubbed

| Component | Status | Location |
|-----------|--------|----------|
| Service Worker proxy | **Real** | `aem-restaurant/sw.js`, `da-nx/sw.js` |
| web-fragment block (parse, SW reg, handshake, element) | **Real** | `aem-restaurant/blocks/web-fragment/web-fragment.js` |
| BroadcastChannel shell↔fragment comms | **Real** | web-fragment block + BookingForm.astro |
| Booking form Astro app on CF Pages | **Real** | `aem-restaurant-booking/` (deployed to `https://aem-restaurant-booking.pages.dev`) |
| `dev_write_files` tool | **Stub** — no-op, returns success | `da-agent/src/tools/dev-tools.ts` |
| `deploy_fragment_app` tool | **Stub** — returns hardcoded URL | `da-agent/src/tools/dev-tools.ts` |
| `da_embed_fragment` tool | **Real** — inserts HTML into DA page | `da-agent/src/tools/tools.ts` |
| `experience-builder` block | **Demo-only** mock code editor | `aem-restaurant/blocks/experience-builder/` |
| `build-web-app.md` skill | **Narrative** — error-resilient, no real deploys | `da-agent/skills/build-web-app.md` |

### Known PoC limitations

1. SW only rewrites `/_astro/` asset paths (Astro-specific); other frameworks need their own rewrite rules.
2. `BroadcastChannel` listener is hardcoded to `/reservations` + `reservation_confirmed` — not data-driven from block config.
3. `web-fragments` library loaded from `esm.sh@latest` — version drift risk.
4. `experience-builder` is purely visual (typewriter animation, hardcoded code string).
5. Fragment config registered per-page-load via `postMessage`; SW loses state on restart.
6. No real GitHub push, build, or deploy pipeline exists.

---

## Part 1 — Gap Analysis for Production

### Target use cases

#### Use Case A — Fictional airline: flights search + booking

- Multi-step form: origin/destination, dates, passengers, seat selection, payment.
- **Requires a backend API** for search, availability, pricing, payment processing.
- Multi-page fragment (search results → seat picker → checkout).
- Framework: Astro or React.

#### Use Case B — Fictional vehicle manufacturer: navigation system visualizer

- Map/canvas rendering (Mapbox GL or similar).
- Vehicle telemetry data feed (WebSocket or SSE).
- 3D model viewer (Three.js or similar).
- Heavier framework: likely React or Svelte.

### Gap 1 — Backend for fragment apps

**Current state:** The booking app is static (`sessionStorage` only). No API layer.

**What's needed:**

- A backend service per fragment app, or a shared API gateway.
- Options: Cloudflare Workers API routes (co-located with the static frontend on CF Pages), AWS Lambda, or AEM backend APIs.
- The backend must be CORS-friendly. Fragment JS runs same-origin (via the SW proxy), but its own API calls to a separate backend are still cross-origin **unless** those API paths are also routed through the SW.
- Authentication: fragment backends need scoped API tokens, never the user's IMS token (see Part 3).

**Decision required:** Should fragment backend API requests route through the SW too (making them same-origin from the browser's perspective), or use standard CORS to their own API origin?

- **SW-routed API:** simpler for the fragment app (no CORS config), but increases SW complexity and makes the SW a bottleneck for API traffic.
- **Direct cross-origin API:** standard pattern, keeps the SW thin, but each fragment backend needs its own CORS policy.

**Recommendation:** Direct cross-origin for the API. Keep the SW focused on document/asset proxying. Fragment backends set `Access-Control-Allow-Origin` for the EDS origin.

### Gap 2 — Real code editor (replace experience-builder mock)

**Current state:** `experience-builder` is a typewriter animation over a hardcoded string with mock badges ("Connected to Figma", "Connected to Enterprise Ground Truth").

**What's needed:**

- Integration with a real code editor component (Monaco Editor or CodeMirror 6).
- Agent streams generated code to the editor via a real-time channel (WebSocket or SSE from da-agent).
- Syntax highlighting, file tabs, diff view for iterative edits.
- The editor itself could be a web-fragment in the DA canvas (demonstrating composability).

**Key question:** Where does this editor live?

| Option | Pros | Cons |
|--------|------|------|
| EDS block in the page | Decorates automatically | No access to DA canvas internals |
| DA canvas native component | Deep integration with editor UI | Requires da-nx changes; tightly coupled |
| Web-fragment in DA canvas | Demonstrates composability; independently deployed | Needs SW + block in canvas; extra latency |

**Recommendation:** Start as an EDS block (simplest path; proven with `experience-builder`). Migrate to a web-fragment once the canvas SW integration (Gap 8) is stable.

### Gap 3 — Deploy pipeline (code → Cloudflare Pages)

**Current state:** `deploy_fragment_app` is a stub that returns a hardcoded URL.

**What's needed:**

```
 da-agent
    │
    ├─ 1. create repo ──────► GitHub API
    ├─ 2. push code ─────────► GitHub API
    │                              │
    │                    3. webhook trigger
    │                              ▼
    │                     Cloudflare Pages
    │                      build + deploy
    │                              │
    │                    4. deploy URL ready
    │                              │
    ◄──────────────────────────────┘
    │
    └─ 5. da_embed_fragment (with deployed URL) ──► DA page
```

**Implementation path:**

1. **GitHub API integration:** Create a new tool `push_to_github` in `da-agent/src/tools/dev-tools.ts`. Uses the GitHub Contents API or Git Data API to create a repo (or branch) and push generated files. Could leverage an existing MCP GitHub tool if available.
2. **CF Pages auto-deploy:** CF Pages already auto-deploys on push to a connected GitHub repo. The agent polls the CF Pages API (`GET /accounts/{id}/pages/projects/{name}/deployments`) until the deploy status is `success`, then extracts the URL.
3. **Alternative fast path:** Use Wrangler's `pages deploy` via a shell tool. Simpler (no GitHub needed), but less "real" for production.

**Recommendation for next iteration:** Wrangler CLI deploy (fast path) first. GitHub integration as a follow-up.

### Gap 4 — Push to GitHub pipeline (fragment code versioning)

**Current state:** `dev_write_files` is a no-op stub. Generated code exists only in the agent's context window.

**What's needed:**

- A real `dev_write_files` implementation that writes files to a temporary directory on the local filesystem (or an in-memory filesystem in the Worker runtime via a staging API).
- A `push_to_github` tool that creates a commit and pushes to a GitHub repo.
- Branch strategy: one repo per fragment app (simple, isolates CI/CD) or one monorepo for all fragments of a site (shared config, more complex CI).
- Version tracking: the DA page's `web-fragment` block should reference a specific fragment version (e.g., a deploy URL with a commit hash or deployment ID), not just `*.pages.dev`.

**Recommendation:** One repo per fragment app. Version is implicitly tracked by the CF Pages deployment URL (each deploy gets a unique `<hash>.pages.dev` URL in addition to the production URL).

### Gap 5 — SW bootstrapping for new sites

**Current state:** `sw.js` and `blocks/web-fragment/` must be manually committed to the site's GitHub repo.

**Options:**

| Approach | Effort | Reliability |
|----------|--------|-------------|
| Agent auto-creates `sw.js` + block code via GitHub API when first fragment is embedded | Medium | Risk of malformed JS if agent generates the SW; needs a canonical template |
| Ship as part of an EDS starter/boilerplate template | Low | Only helps new sites; existing sites still need manual addition |
| DA platform injects them automatically when a page contains a `web-fragment` block | High | Best UX; requires platform-level changes |

**Recommendation:** Ship a canonical `sw.js` and `blocks/web-fragment/` in the EDS boilerplate. For existing sites, the agent commits the files via GitHub API on first use (using a verified template, not generated code).

### Gap 6 — Framework-agnostic asset rewriting

**Current state:** The SW only rewrites `/_astro/` paths in proxied HTML.

**What's needed for other frameworks:**

| Framework | Asset path pattern | Rewrite needed |
|-----------|-------------------|----------------|
| Astro | `/_astro/` | `/__wf/{id}/_astro/` (done) |
| Vite (React/Vue/Svelte) | `/assets/` | `/__wf/{id}/assets/` |
| Next.js | `/_next/` | `/__wf/{id}/_next/` |
| Vanilla / custom | varies | configurable |

**Implementation options:**

1. **Generic rewrite:** Parse all absolute paths in HTML (`src="/"`, `href="/"`) and prefix with the route prefix. Risk: over-rewriting (e.g., rewriting links to other pages).
2. **Fragment manifest:** Each fragment app includes a `web-fragment.json` at its root declaring its asset prefixes. The SW reads this on registration and rewrites accordingly.
3. **Require relative paths:** Mandate that fragment apps use relative asset paths. Simpler but constraining; some frameworks default to absolute paths.

**Recommendation:** Option 2 (fragment manifest). The SW reads `web-fragment.json` from the fragment endpoint during registration:

```json
{
  "assetPrefixes": ["/_astro/", "/assets/"],
  "broadcastChannels": ["/reservations"]
}
```

This also solves the hardcoded `BroadcastChannel` problem (Gap 9).

### Gap 7 — Multi-fragment pages

**Current state:** Only one fragment per page has been tested.

**What's needed:**

- Multiple `web-fragment` blocks on the same page, each with a unique `fragment-id` and route prefix.
- The SW already supports multiple registrations (uses a `Map` keyed by `fragmentId`) — this is architecturally sound but **untested**.
- Fragment-to-fragment communication could use `BroadcastChannel` (already proven for shell↔fragment).

**Testing plan for next iteration:**

1. Add a second fragment (e.g., a reviews widget alongside the booking form).
2. Verify both fragments load and route correctly through the SW.
3. Verify that fragment A can post on a channel that fragment B listens on.

### Gap 8 — DA canvas preview (WYSIWYG)

**Current state:** Fragments render only on the published EDS page, not in the DA editor canvas.

**What's needed:**

- The DA canvas (da-nx) must register and run the SW during editing.
- The `web-fragment` block must decorate correctly in the canvas environment.
- The `sw.js` is already mirrored in `da-nx/sw.js` and the block in `da-nx/nx/blocks/web-fragment/` — but the canvas hasn't been tested with a live fragment.

**Challenges:**

- The DA canvas may use a different origin than the published page. The SW's same-origin check (`url.origin !== self.location.origin`) must match.
- The canvas may interfere with the SW's `clients.claim()` if other SWs are already active.
- The canvas editor's DOM manipulation (ProseMirror/Y.js) may conflict with the web-fragment's reframed DOM injection.

**This is the highest-effort gap and likely requires dedicated engineering time.**

### Gap 9 — Generic BroadcastChannel wiring

**Current state:** `listenForFragmentEvents` in `web-fragment.js` is hardcoded to listen on `/reservations` for `reservation_confirmed`.

**What's needed:**

- The `web-fragment` block reads a `channels` config row from its HTML table.
- For each channel name, it opens a `BroadcastChannel` and attaches a generic event handler.
- The handler surfaces events as customizable UI notifications (not just a reservation banner).
- The event contract per fragment is documented in its `web-fragment.json` manifest (see Gap 6).

**Implementation sketch for `web-fragment.js`:**

```javascript
const channelNames = config.channels
  ? config.channels.split(',').map(c => c.trim())
  : [];

channelNames.forEach((name) => {
  const bc = new BroadcastChannel(name);
  bc.addEventListener('message', (event) => {
    const { type, ...payload } = event.data || {};
    // Dispatch a custom event on the block element
    block.dispatchEvent(new CustomEvent('wf:event', {
      detail: { channel: name, type, ...payload },
      bubbles: true,
    }));
  });
});
```

The host page (or a shell block) can then listen for `wf:event` and render appropriate UI.

---

## Part 2 — AEM Content Fragment API Integration

### How AEM Content Fragments work

AEM provides two APIs for content fragment delivery:

1. **GraphQL API** — schema auto-generated from Content Fragment Models, read-only, persisted queries, served from `/graphql/execute.json/...`. Based on the GraphQL Java library.
2. **OpenAPI (REST)** — JSON delivery with modern CDN integration and active content invalidation, served from the AEM publish tier. Supports fragment reference hydration.

Additionally, Content Fragments can be published to Edge Delivery Services as **self-contained semantic HTML** via the [json2html overlay service](https://aem.live/developer/content-fragment-overlay). This uses a Mustache template to transform the fragment JSON into semantic HTML that EDS can ingest.

### How fragment apps would consume AEM content

```
 ┌──────────────────────────────────────────────────────────────┐
 │  AEM Author                                                 │
 │  ├─ Content Fragment Model (schema)                         │
 │  └─ Content Fragments (instances)                           │
 └───────────────────────────┬──────────────────────────────────┘
                             │ publish
         ┌───────────────────┼──────────────────┐
         ▼                   ▼                  ▼
 ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐
 │ GraphQL API │    │ OpenAPI     │    │ json2html        │
 │ (persisted  │    │ (JSON+CDN)  │    │ (overlay → EDS)  │
 │  queries)   │    │             │    │                  │
 └──────┬──────┘    └──────┬──────┘    └────────┬─────────┘
        │                  │                    │
        │    ┌─────────────┘                    │
        ▼    ▼                                  ▼
 ┌──────────────────┐                  ┌──────────────────┐
 │ Fragment App     │                  │ EDS Page         │
 │ Backend          │                  │ (semantic HTML)  │
 │ (CF Worker)      │                  │                  │
 └────────┬─────────┘                  └──────────────────┘
          │                                     │
          ▼                                     │
 ┌──────────────────┐                           │
 │ Fragment App     │    ◄──────────────────────┘
 │ Frontend         │    (embedded via web-fragment)
 │ (Astro/React)    │
 └──────────────────┘
```

### Integration patterns

#### Pattern A — Build-time content (SSG)

The fragment app fetches from GraphQL/OpenAPI during its build step (e.g., `astro build`). Content is baked into static HTML.

- **Pros:** Fast delivery, no runtime dependency on AEM, great for content that changes infrequently.
- **Cons:** Content goes stale until the app is rebuilt. Requires a rebuild trigger when content changes (webhook from AEM → rebuild pipeline).
- **Best for:** Vehicle catalog pages, airline route maps, static marketing content.

#### Pattern B — Runtime content (CSR or SSR)

The fragment's backend (a CF Worker) queries GraphQL/OpenAPI on each request, returning fresh JSON to the frontend.

- **Pros:** Always up-to-date content. Supports personalization and dynamic queries.
- **Cons:** Runtime dependency on AEM publish tier availability. Added latency. Auth complexity (backend needs AEM credentials).
- **Best for:** Flight search results, seat availability, pricing, vehicle telemetry.

#### Pattern C — EDS-published content fragments (json2html)

Content Fragments are published to EDS via the json2html overlay as semantic HTML pages. The fragment app can either:
- Read this HTML and progressively enhance it (hydration), or
- Use it as a data source by parsing the semantic structure.

- **Pros:** Content is LLM/SEO-readable out of the box. Fast initial load (static HTML from CDN). No runtime dependency on AEM.
- **Cons:** Requires json2html service setup and Mustache template maintenance. Tight coupling between CF Model fields and the template. Changes to the model require template updates.
- **Best for:** Press releases, blog posts, product descriptions — structured content that benefits from being both a standalone page and an embeddable fragment.

#### Recommended patterns for the target use cases

| Use case | Pattern | Rationale |
|----------|---------|-----------|
| Airline — route/destination info | A (SSG) | Relatively static catalog data; rebuild on content change |
| Airline — flight search + pricing | B (runtime) | Dynamic queries, real-time availability |
| Airline — booking confirmation | B (runtime) | Transactional, requires backend processing |
| Vehicle — model catalog | A (SSG) | Static product data |
| Vehicle — live telemetry/navigation | B (runtime) | Real-time data feed via WebSocket/SSE |
| Vehicle — owner's manual / docs | C (json2html) | Structured content, SEO-important, infrequently updated |

### Risk matrix

| Risk | Severity | Mitigation |
|------|----------|------------|
| **AEM publish tier availability** — fragment apps using Pattern B depend on AEM being reachable at request time | High | Cache aggressively at the CF Worker layer; serve last-known-good JSON on AEM timeout; set up health checks |
| **Auth token forwarding** — GraphQL/OpenAPI require auth; fragment backend needs AEM credentials | High | Use IMS S2S (server-to-server) OAuth credentials scoped per fragment app; never expose user's IMS token (see Part 3) |
| **Content model coupling** — fragment code breaks if CF Model fields are renamed/removed | Medium | Version Content Fragment Models; generate TypeScript types from the model schema; CI tests that validate fragment code against the model |
| **CORS between fragment backend and AEM** — CF Worker calling AEM publish is server-to-server | Medium | Not a browser CORS issue (Worker-to-AEM is a server request); use IMS S2S auth with `Authorization: Bearer <token>` |
| **Cache invalidation lag** — OpenAPI CDN cache is ~1 hour by default; updates may be delayed | Medium | Use the OpenAPI's active invalidation (soft purge on publish); or set shorter cache TTLs for time-sensitive content |
| **json2html template drift** — Mustache templates can diverge from CF Model changes | Medium | CI pipeline validates templates against the model schema; consider schema-driven template generation |
| **GraphQL query complexity** — deeply nested fragment references can be expensive | Low | Use persisted queries with depth limits; monitor query performance via AEM Cloud Manager |
| **Dual content source confusion** — content lives in both DA (page structure) and AEM (structured fragments) | Medium | Establish clear ownership: DA owns the page shell and layout; AEM Content Fragments own the structured data. Document this boundary per project |

---

## Part 3 — IMS Token Isolation

### How DA handles IMS auth today (and why the token is JS-accessible)

DA uses Adobe's browser IMS library (`imslib` from `auth.services.adobe.com`).
The configuration in `da-nx/nx/utils/ims.js` sets `useLocalStorage: true` and
relies on `window.adobeIMS.getAccessToken()` to obtain the token at runtime.

**This is a DA architectural choice, not an IMS SDK constraint.** The IMS
platform supports server-side flows (S2S OAuth, authorization-code with
backend exchange) that would allow HttpOnly cookie storage. However, DA chose
a pure client-side SPA model where:

- The token is read from JS via `window.adobeIMS.getAccessToken()`.
- `daFetch()` (in `da-nx/nx/utils/daFetch.js`) attaches `Authorization: Bearer`
  on every API call from client JS.
- The collab WebSocket passes the token as a WS subprotocol or query parameter
  (in `da-collab/src/edge.js`).
- The shell sends the raw token via `postMessage` to embedded iframes
  (in `da-nx/nx/blocks/shell/shell.js` — `postMessage(message, '*')`).
- The IMS SDK itself persists session material in `localStorage` (SDK-controlled
  keys, readable by any same-origin JS).

There is a secondary `.gimme_cookie` flow that establishes cookies on
preview/content hosts, but the primary IMS access token remains JS-readable at
all times. **No part of the current DA auth flow uses HttpOnly cookies for the
IMS token.**

### The problem for web fragments

Because the SW makes fragment apps appear same-origin, a fragment's JavaScript
can potentially access:

1. **`localStorage`** — where the IMS SDK persists session material
   (`useLocalStorage: true`). Any same-origin JS can call
   `window.adobeIMS.getAccessToken()` or read the SDK's storage keys directly.
2. **Cookies** — same-origin cookies are shared across all same-origin contexts,
   including the reframed iframe.
3. **Fetch interception** — fragment JS could monkey-patch `fetch` or
   `XMLHttpRequest` to intercept `Authorization: Bearer` headers on outgoing
   DA API requests.
4. **SW `postMessage`** — fragment JS could message the SW and attempt to
   extract config or manipulate routing.
5. **Shell `postMessage`** — if the fragment can listen for messages from the
   shell, it could intercept the raw token broadcast.

This is a fundamental tension: the SW proxy **intentionally** makes fragments
same-origin (to avoid CORS and enable reframing), but same-origin means shared
security context.

### What web-fragments reframing provides (and doesn't)

Web Fragments' **reframing** technique creates a hidden same-origin iframe with monkey-patched DOM and JS APIs. This gives each fragment:

- A separate `window` / JS execution context (isolated module registry, timers, listeners).
- DOM operations scoped to the fragment's shadow DOM in the main document.
- Automatic cleanup when the fragment is destroyed (memory, modules, listeners freed).

**Reframing does NOT provide:**

- Cookie isolation (same origin = same cookies in the iframe).
- Storage isolation (`localStorage`/`sessionStorage` are shared by origin, not by iframe).
- Network isolation (fragment JS can still `fetch()` any same-origin URL, including DA API endpoints).
- SW access isolation (fragment JS can still `navigator.serviceWorker.controller.postMessage()`).

Reframing is a **JS encapsulation** mechanism, not a **security boundary**. It prevents accidental collisions, not malicious access.

### Isolation strategies

#### Strategy 1 — Path-scoped token proxy (recommended for PoC+1)

```
 Fragment App JS
       │
       │  fetch("/__wf/booking-app/api/...")
       ▼
  Service Worker
       │
       ├─ path matches /__wf/* → proxy to fragment endpoint (NO token attached)
       │
       └─ path matches /__da/* → inject Authorization header, forward to DA API
              │
              └─ validate Referer / signed nonce (reject if from fragment context)
```

**How it works:**

- The SW **never** attaches the IMS token to requests proxied to fragment endpoints (`/__wf/*` paths).
- Only requests to DA's own API paths (`/__da/*`) get the `Authorization` header injected.
- To prevent fragment JS from crafting `/__da/*` requests, the SW validates the `Referer` header or requires a signed nonce that only the host page's (non-reframed) JS can produce.

**Strengths:** Minimal changes to the existing architecture. The SW already differentiates by path prefix.

**Weaknesses:** A determined attacker in fragment JS can still read `document.cookie` or `localStorage` directly. The `Referer` check can be spoofed by code running in the reframed iframe (it shares the origin). This is a **defense-in-depth** measure, not a hard security boundary.

#### Strategy 2 — HttpOnly cookies + Backend-for-Frontend (recommended for production)

- Move the IMS token out of JavaScript entirely: store it as an `HttpOnly`, `SameSite=Strict`, `Secure` cookie.
- DA API calls go through a Backend-for-Frontend (BFF) server that reads the `HttpOnly` cookie and attaches the token server-side.
- Fragment JS (or any JS) **cannot** read `HttpOnly` cookies — this is enforced by the browser, not by monkey-patches.
- The SW never handles the token at all.

**Important:** This is technically feasible — IMS supports authorization-code flows where the token exchange happens server-side. The current client-only model (`useLocalStorage: true`, `getAccessToken()` from JS, Bearer via `daFetch`, WS subprotocol, `postMessage`) is a DA design choice that would need to be refactored. The changes required:

1. Replace `imslib` client-side token persistence with an authorization-code redirect flow where the BFF receives the code and exchanges it for tokens server-side.
2. Replace all `daFetch()` calls that attach `Authorization: Bearer` with cookie-authenticated requests to the BFF (the BFF proxies to da-admin with the token).
3. Replace the WebSocket subprotocol/query-param auth with a session cookie on the WS upgrade request.
4. Remove the `postMessage` token sharing in `shell.js` — embedded apps would authenticate via the same cookie-based BFF.

**Strengths:** Hardened by the browser's cookie security model. No JS-accessible token in the page. Eliminates the entire class of token-theft attacks from fragments.

**Weaknesses:** Requires a new BFF service, which changes DA's current client-side auth architecture. Adds latency for DA API calls (extra hop through BFF). Requires careful cookie path/domain configuration. The BFF becomes a critical availability dependency.

#### Where the BFF would live

The entire DA backend is Cloudflare Workers today:

| Service | Runtime | Role |
|---------|---------|------|
| `da-admin` | CF Workers | Content API, auth (JWKS verify), KV, R2 |
| `da-collab` | CF Workers + Durable Objects | Yjs WebSocket sessions |
| `da-agent` | CF Workers (`nodejs_compat`) | AI assistant, tool execution |

None of these services manage cookies or server-side sessions. Auth is
`Authorization: Bearer` everywhere.

The BFF would be a **new Cloudflare Worker** (`da-bff`) following the same
deployment pattern (`wrangler.toml` → `wrangler-versioned.toml` via
`prepare-deploy.js`). It would:

```
 Browser (da-live / da-nx)
       │
       │  1. IMS auth-code redirect → da-bff
       ▼
 da-bff (new CF Worker)
       │
       │  2. Exchange auth code for IMS access token (server-side)
       │  3. Set-Cookie: session=<encrypted-token>; HttpOnly; Secure; SameSite=Strict
       │  4. Return redirect to DA editor
       │
       │  On subsequent requests:
       │  5. Read session cookie → decrypt → extract IMS token
       │  6. Proxy to da-admin with Authorization: Bearer <token>
       │
       ├─ service binding ──► da-admin (CF Worker)
       └─ service binding ──► da-collab (CF Worker, for WS upgrade with token)
```

**Implementation specifics:**

- **Token storage:** Encrypted in the cookie value itself (stateless), or stored
  in KV with the cookie holding a session ID (stateful). Stateless is simpler
  but limits cookie size; stateful adds a KV dependency but keeps cookies small.
- **Cookie domain:** Must be set on a domain shared by `da.live` and the DA API
  origin. If these are on different domains, a `*.da.live` or shared parent
  domain is needed for `SameSite=Strict` to work.
- **WebSocket auth:** The WS upgrade request to `da-collab` would carry the
  session cookie. `da-bff` reads the cookie, extracts the token, and opens
  the upstream WS to `da-collab` with the Bearer subprotocol (transparent to
  the client).
- **Fragment isolation:** Fragment apps on `/__wf/*` routes are same-origin but
  the HttpOnly cookie is invisible to their JS. They cannot read, forward, or
  intercept the token. This is the core security win.
- **wrangler.toml sketch:**
  ```toml
  name = "da-bff"
  main = "src/index.ts"
  compatibility_date = "2026-04-01"
  compatibility_flags = ["nodejs_compat"]

  [vars]
  IMS_CLIENT_ID = "..."
  DA_ORIGIN = "https://da.live"

  [[services]]
  binding = "DAADMIN"
  service = "da-admin"

  [[services]]
  binding = "DACOLLAB"
  service = "da-collab"

  [[kv_namespaces]]
  binding = "SESSIONS"
  id = "..."  # only if using stateful sessions
  ```

#### Strategy 3 — Fenced Frames (future web platform)

- The [Fenced Frame](https://wicg.github.io/fenced-frame/) proposal provides true isolation boundaries: no `postMessage`, no shared storage, no cookie access across the boundary.
- Currently Chrome-only and primarily designed for ads/attribution use cases.
- Web Fragments would need to support Fenced Frames as an alternative to reframed iframes.

**Not viable today**, but worth monitoring. If Fenced Frames mature and gain cross-browser support, they would be the ideal isolation primitive for untrusted fragments.

#### Strategy 4 — Fragment-scoped service account tokens

- Instead of sharing the user's IMS token, issue a **scoped service account token** per fragment app.
- The token is generated server-side (by da-agent or a dedicated token service) with minimal permissions — e.g., read-only access to specific Content Fragment Models.
- Passed to the fragment's backend via environment variables (at deploy time) or via a secure config endpoint.
- The fragment app can only access AEM resources allowed by its scoped token.

**This is the recommended approach for AEM Content Fragment API access.** The fragment backend uses its own S2S credential. The user's IMS token is never involved in fragment-to-AEM communication.

**Strengths:** Principle of least privilege. Each fragment has exactly the permissions it needs. Credential rotation is per-fragment.

**Weaknesses:** Token provisioning infrastructure needed (token service, secret management). More credentials to manage.

#### Strategy 5 — Partition storage by fragment ID

- Extend reframing's monkey-patches to cover storage APIs:
  - `localStorage.getItem(key)` → `localStorage.getItem(`${fragmentId}:${key}`)`
  - `sessionStorage` — same treatment
  - `document.cookie` getter — filter to only return cookies with a fragment-specific prefix
- This prevents **accidental** storage collisions between fragments and the host page.

**Strengths:** Simple to implement as an extension of existing reframing patches. Prevents well-behaved fragments from seeing host data.

**Weaknesses:** Not a security boundary. Malicious JS can bypass monkey-patches (e.g., access the unpatched `Storage` prototype directly). Only useful as a defense-in-depth layer.

### Recommendation

| Phase | Strategy | What it achieves |
|-------|----------|-----------------|
| **PoC+1** (next iteration) | Strategy 1 (path-scoped proxy) + Strategy 4 (fragment S2S tokens) | SW never leaks IMS token to fragments; fragment backends have their own scoped credentials for AEM APIs |
| **Production** | Add Strategy 2 (HttpOnly cookies + BFF) | Eliminates JS-accessible IMS tokens entirely; hardened by browser security model |
| **Defense-in-depth** | Add Strategy 5 (partitioned storage) | Prevents accidental storage collisions; nice-to-have for multi-fragment pages |
| **Future** | Monitor Strategy 3 (Fenced Frames) | True browser-enforced isolation if/when the spec matures |

### Token flow for AEM Content Fragment access (production target)

```
 User in DA Editor
       │
       │  (IMS token stored as HttpOnly cookie — JS cannot read it)
       │
       │  User asks agent: "show flight results from AEM content"
       ▼
  da-agent
       │
       ├─ generates fragment app code
       ├─ provisions S2S credential scoped to the "flights" CF Model
       ├─ deploys fragment app with S2S credential as env var
       └─ embeds fragment in DA page
              │
              ▼
  Fragment Backend (CF Worker)
       │
       │  Uses its own S2S token (not the user's IMS token)
       │  to query AEM GraphQL API for flight data
       ▼
  AEM Publish (GraphQL API)
       │
       │  Returns Content Fragment JSON
       ▼
  Fragment Frontend
       │
       │  Renders flight results in the web-fragment
       ▼
  User sees results in the EDS page
```

The user's IMS token and the fragment's S2S token never cross paths. The fragment cannot escalate its permissions to the user's access level.

---

## Summary — Prioritized Roadmap

| Priority | Gap | Effort | Dependency |
|----------|-----|--------|------------|
| **P0** | Generic asset rewriting (Gap 6) + fragment manifest | Small | None |
| **P0** | Generic BroadcastChannel wiring (Gap 9) | Small | Fragment manifest |
| **P0** | Multi-fragment page testing (Gap 7) | Small | None |
| **P1** | Real `dev_write_files` implementation (Gap 4) | Medium | None |
| **P1** | Deploy pipeline — Wrangler CLI path (Gap 3) | Medium | Real `dev_write_files` |
| **P1** | SW path-scoped token proxy (Part 3, Strategy 1) | Medium | None |
| **P1** | Fragment S2S token provisioning (Part 3, Strategy 4) | Medium | AEM S2S OAuth setup |
| **P2** | GitHub push pipeline (Gap 4) | Medium | GitHub API access |
| **P2** | SW bootstrapping for new sites (Gap 5) | Medium | GitHub API or boilerplate template |
| **P2** | Real code editor block (Gap 2) | Large | Agent streaming infrastructure |
| **P3** | DA canvas preview (Gap 8) | Large | da-nx engineering |
| **P3** | `da-bff` CF Worker — HttpOnly cookies + BFF (Part 3, Strategy 2) | Large | DA auth architecture change; cookie domain alignment across `da.live` / API origins |
| **P3** | AEM Content Fragment integration (Part 2) | Large | AEM Cloud Service environment + S2S setup |

---

## Appendix A — File Reference

| File | Repo | Branch | Purpose |
|------|------|--------|---------|
| `sw.js` | `aem-restaurant` | `feat/web-fragment-sw` | Service Worker proxy (EDS site) |
| `sw.js` | `da-nx` | local | Service Worker proxy (DA canvas mirror) |
| `blocks/web-fragment/web-fragment.js` | `aem-restaurant` | `feat/web-fragment-sw` | EDS block: SW registration, config, element creation |
| `blocks/web-fragment/web-fragment.css` | `aem-restaurant` | `feat/web-fragment-sw` | Confirmation banner styles |
| `blocks/experience-builder/experience-builder.js` | `aem-restaurant` | `feat/web-fragment-sw` | Demo-only mock code editor |
| `blocks/experience-builder/experience-builder.css` | `aem-restaurant` | `feat/web-fragment-sw` | Mock editor styles |
| `nx/blocks/web-fragment/web-fragment.js` | `da-nx` | local | DA canvas mirror of web-fragment block |
| `skills/build-web-app.md` | `da-agent` | `ew` | Agent skill for the Web Fragments workflow |
| `src/tools/dev-tools.ts` | `da-agent` | `ew` | Stub tools: `dev_write_files`, `deploy_fragment_app` |
| `src/tools/tools.ts` | `da-agent` | `ew` | Real tool: `da_embed_fragment` |
| `astro.config.mjs` | `aem-restaurant-booking` | `main` | Fragment app Astro config |
| `public/_headers` | `aem-restaurant-booking` | `main` | CORS headers for SW proxy |
| `src/components/BookingForm.astro` | `aem-restaurant-booking` | `main` | Booking form component with BroadcastChannel |
| `push-to-da.sh` | `aem-restaurant` | `feat/web-fragment-sw` | Script to push content to DA + preview |
| `docs/web-fragments-poc.md` | `da-agent` | `ew` | PoC documentation (frozen reference) |

## Appendix B — Glossary

| Term | Definition |
|------|-----------|
| **EDS** | Edge Delivery Services — Adobe's CDN-based site delivery platform |
| **DA** | Document Authoring — the WYSIWYG editor for EDS sites |
| **da-nx** | The DA editor frontend (canvas) |
| **da-agent** | The AI assistant integrated into the DA editor |
| **CF Pages** | Cloudflare Pages — static site hosting with auto-deploy from GitHub |
| **SW** | Service Worker — browser API for intercepting and proxying network requests |
| **IMS** | Identity Management Service — Adobe's OAuth identity provider |
| **S2S** | Server-to-Server — OAuth credential flow for machine-to-machine auth (no user interaction) |
| **BFF** | Backend-for-Frontend — a server-side proxy that handles auth on behalf of a client |
| **Reframing** | Web Fragments' JS/DOM virtualization technique using a hidden same-origin iframe |
| **Content Fragment** | A structured content object in AEM, defined by a Content Fragment Model |
| **json2html** | An EDS overlay service that transforms AEM Content Fragment JSON into semantic HTML |
| **Fragment manifest** | (Proposed) A `web-fragment.json` file at the fragment app's root declaring asset prefixes and channel names |
