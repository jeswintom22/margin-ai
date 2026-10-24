# Margin AI — AI-Ready Digital Notebook

A local-first, Xournal++-inspired handwriting notebook built for the DevDay Exchange
Community Hackathon: Kochi. Its document model is designed so an AI tutor can later
write solutions onto a user's notes as a separate, non-destructive layer.

**[Event rules](RULES.md)** · **[Agent instructions](AGENTS.md)** · **[Submission](SUBMISSION.md)**

## Project overview

- **Project name:** Margin AI
- **Short description:** Write handwritten notes with mouse, touch, or stylus across
  multiple notebooks and pages. Everything autosaves to the browser (IndexedDB) and
  survives refresh. The layered document model keeps future AI-authored strokes
  structurally separate from user content — MVP 1 ships no AI features.
- **Team:** TODO — participant names and GitHub handles; maximum 4 members.
- **Working demo:** Local — `npm install && npm run dev`, open http://localhost:3000.
- **Technology stack:** Next.js 16 (App Router), React 19, TypeScript (strict),
  Tailwind CSS 4, HTML Canvas, Pointer Events, IndexedDB (`idb`), `zod`, Vitest.

### Run the project

1. Prerequisites: Node.js ≥ 20 (developed on v25), npm ≥ 10.
2. `npm install`
3. Environment (only needed for the assistant): copy `.env.example` to `.env.local` and set
   `LLM_API_KEY`. Optional: `LLM_BASE_URL` (any OpenAI-compatible endpoint, default
   `https://api.openai.com/v1`), `LLM_MODEL` (default `gpt-4o-mini`), `LLM_TIMEOUT_MS`.
   The notebook works fully without these; the assistant then reports that it is not configured.
4. `npm run dev` → http://localhost:3000 (or `npm run build && npm start`)
5. Checks: `npm test` (Vitest), `npm run typecheck`, `npm run lint`.

### Current status

- **Working features:** pen/highlighter/eraser/selection tools with pressure-aware
  strokes; per-page undo/redo; notebook & page management (create/rename/reorder/
  delete with confirms); blank/ruled/grid paper; debounced autosave + save status;
  JSON export/import with schema validation; multi-tab conflict warning; responsive
  collapsible sidebar; keyboard shortcuts (`P`/`H`/`E`/`S`, `Ctrl+Z`/`Ctrl+Y`,
  `Delete`, `Esc`).
- **Assistant panel (structured answers):** the toolbar's **Assistant** button opens a side
  panel. `POST /api/ask` → `lib/ai/answerService.ts` asks the configured provider for a
  JSON `AnswerDocument` (title + typed blocks), validated by Zod in `lib/ai/answerSchema.ts`
  before reaching the browser. The client renders blocks with `AnswerView.tsx`
  (paragraphs, headings, lists, callouts, math/derivations as LaTeX text, definitions,
  code, steps, tables, SVG diagrams, annotations). The API key is server-only. Answers
  stay in the panel; nothing is written into the notebook yet.
- **Known limitations:** No palm rejection (browsers don't expose reliable palm data);
  eraser removes whole strokes only; multi-tab editing warns but doesn't merge;
  no E2E browser tests yet. Assistant: no conversation memory (each question is
  independent), exchanges are lost on refresh, no streaming, and answers are not yet
  inserted onto pages. Structured answers: LaTeX is displayed as text (no math renderer
  yet); diagrams draw in normalized 0-100 SVG space; answers are never labeled verified
  (no deterministic checking exists). Local request limiting is process-wide only; production requires
  an external per-client rate-limiting gateway (see below).
- **Libraries, APIs, and public datasets used:**
  [Next.js](https://nextjs.org), [React](https://react.dev),
  [Tailwind CSS](https://tailwindcss.com), [idb](https://github.com/jakearchibald/idb),
  [zod](https://zod.dev), [Vitest](https://vitest.dev),
  [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB).
  External API: one OpenAI-compatible chat completions provider of your choice (configured
  via `LLM_BASE_URL`), used only by the assistant. No datasets.

See [AI_USAGE.md](AI_USAGE.md) for AI assistance and [CHANGELOG.md](CHANGELOG.md) for the development record.

## Assistant request protection and production deployment

`POST /api/ask` still returns `{ answer }` or `{ error }`. Questions remain limited
to 4,000 characters. Bodies are limited to **32 KiB of UTF-8 bytes**, checked both
against `Content-Length` and while reading the stream before JSON parsing. Extra
fields/JSON escaping count toward that limit. Invalid JSON/questions return 400,
oversized bodies 413, local throttling 429 with `Retry-After` seconds, missing
protection/configuration 503, upstream failure 502, and upstream timeout 504.
Responses use `Cache-Control: no-store`; provider bodies, unexpected exceptions,
and full questions are not logged or included in error responses.

- **Local development:** `ASK_LOCAL_RATE_LIMIT` (default 10) and
  `ASK_LOCAL_RATE_WINDOW_MS` (default 60000) configure a fixed-window bucket shared
  by all callers in one process. Both must be positive safe integers. No client IP
  is inferred: `X-Forwarded-For`, `X-Real-IP`, cookies, and other caller-controlled
  identity values cannot create fresh buckets. This conservative fallback resets
  on restart and is **not distributed production protection**. Malformed requests
  also consume quota. Keep the development server bound to a trusted local network.
- **Production (`NODE_ENV=production`, including `npm start`):** the route fails
  closed with 503 unless `ASK_EXTERNAL_RATE_LIMIT_ENABLED=true`. This is an operator
  attestation, **not a limiter** and not something a request header can enable.
  Leave it false until a gateway/WAF enforces a configurable per-client quota for
  every `POST /api/ask` across all instances. Configure quota/window in that gateway
  (10 requests/minute is a starting point, not a guarantee of an affordable budget).
  Use authenticated identity where available, or the gateway's actual connection IP;
  strip/overwrite untrusted forwarding headers and document the proxy trust chain.
  Block all direct origin/alternate deployment URL access, and verify that varying
  forwarding headers cannot evade throttling. The gateway must return 429 with a
  suitable `Retry-After`; configure JSON `{ error }` responses to preserve the UI contract.
- There is no deployment-specific gateway or shared store configured in this repo.
  No Redis/database dependency was added. A platform gateway can supply distributed
  enforcement without one; otherwise design an atomic shared-store limiter and a
  trustworthy identity integration before enabling production requests. Do not
  substitute a process-local map on serverless/multi-process deployments.
- Also configure gateway body/read deadlines, connection/concurrency limits, and
  provider spending/output-token limits. The app byte cap does not prevent slow
  uploads or large upstream answers, and fixed windows permit boundary bursts.
  Anonymous IP quotas can be evaded with multiple IPs and can group users behind NAT.
- `LLM_TIMEOUT_MS` defaults to 30000 and must be an integer from 1 through 120000.
  The existing fetch abort deadline covers the upstream response body as well as
  headers; upstream body aborts now return 504. No real provider calls are needed
  for tests: route/LLM fetches and limiter dependencies are mocked.

## Architecture

```
app/                    Next.js App Router shell (single route)
components/
  canvas/PaperCanvas    canvas element: pointer input, DPR handling, rAF paint loop
  notebook/             Toolbar, Sidebar, NotebookApp (wiring + shortcuts)
  ErrorBoundary.tsx
lib/
  document/types.ts     document model (Notebook → Page → Layer → Stroke), factories
  document/schema.ts    zod validation, schemaVersion, migration entry point
  drawing/geometry.ts   hit-testing, rect intersection, RDP point simplification
  drawing/coords.ts     client↔page coordinate conversion, fit-scale
  drawing/render.ts     paper background, smoothed stroke rendering (pressure width)
  history/history.ts    PageHistory: undoable ops (addStroke, eraseStrokes)
  storage/db.ts         IndexedDB via idb (notebooks + meta stores)
  storage/exportImport.ts
app/api/ask/route.ts    POST endpoint: request validation, delegates to answerService
lib/ai/llm.ts           server-only OpenAI-compatible client (config from env)
lib/ai/answerSchema.ts  AnswerDocument Zod schema + block limits (client-safe)
lib/ai/answerService.ts structured generation: prompt, JSON extraction, validation
lib/ai/requestProtection.ts  body-size limit + local rate limiting
lib/ai/types.ts         request/response types and validation shared with the client
components/notebook/AssistantPanel.tsx   question box + answer list
components/notebook/AnswerView.tsx       typed renderer for answer blocks
hooks/useNotebook.ts    app store: doc state, tools, autosave, conflicts, AI ops
tests/                  Vitest suites (geometry, coords, history, document, storage)
```

### Document model decisions

- **Page-space coordinates.** Strokes store document units; pages have a fixed
  intrinsic size (794×1123, A4@96dpi), so strokes survive resize, DPR change, and zoom.
- **Layers separate user and AI content.** Every page has a `user` layer; AI strokes go
  into a dedicated `ai` layer (hide/edit/delete independently). User strokes are never
  merged or overwritten.
- **Erasing is reversible.** `eraseStrokes` ops record removed strokes + indices and
  append an `EraserOperation` provenance record; undo restores original positions.
- **Schema versioning.** Version 1 is both the current and oldest supported format.
  `parseNotebook()` / `migrateNotebook()` validate the complete v1 document, including
  a user layer on each page. JSON imports and IndexedDB loading/listing use this same
  policy. Future versions fail with an update instruction; unsupported older versions
  and malformed versions/documents fail without relabeling or rewriting stored data.
  No historical migrations exist. Existing v1 defaults for omitted page titles and
  eraser logs remain supported; complete valid v1 documents retain all modeled data.
  JSON exports still use `format: "margin-ai-notebook"` and `formatVersion: 1`;
  importing intentionally generates a fresh notebook ID and updates `updatedAt`.
- **History scope.** Undo/redo stacks are per page; page structural ops use
  confirmations (documented trade-off).

### Introducing document schema version 2

1. Design the actual feature and v2 fields first; do not add speculative fields or
   invent a pre-v1 format. Keep the v1 validator available with a literal version 1.
2. Define a separate v2 validator (literal version 2), update the current TypeScript
   model/factories, and then bump `SCHEMA_VERSION`. The export envelope version and
   IndexedDB database version are separate from the document schema version.
3. Add an explicit v1 → v2 step in `migrateNotebook()`. Dispatch on the input version
   before applying the current validator. Validate the source with its own schema,
   transform without mutating input, and validate the result with the v2 schema,
   including page/user-layer invariants. For later versions, run only consecutive
   steps (v1 → v2 → v3), validate after each step, and validate the final result with
   the current schema. A missing step must throw, never jump to the current version.
4. Keep transformations deterministic: no clock, random IDs, or external calls.
   Preserve existing IDs, pages, layers, strokes, provenance, and metadata. Repeated
   parsing of the migrated/current document must produce the same data.
5. Add real v1 fixtures and tests for preservation, source/output validation,
   repeated migration, missing steps, malformed/future versions, JSON round-trips,
   and IndexedDB loading. Both entry points must continue using the shared parser.
6. Run tests, typecheck, lint, and build; document actual compatibility and limitations.
   Loading currently does not write parsed data back to IndexedDB. Any future
   migration persistence policy must protect the original on failure.

### AI-readiness hooks (implemented, no UI)

- `selectInRect(rect)` → region/stroke selection
- `insertAIStrokes(strokes)` → write AI-authored strokes at document coords
- `setAILayerVisible(bool)` → toggle the AI layer
- `author` on every stroke/layer distinguishes provenance; cropped region capture is
  an offscreen `renderPage` call away.

## Testing

135 tests cover stroke geometry, coordinate conversion under resize, undo/redo,
eraser transactions and gesture cancellation, validation/migration, user↔AI layer
separation, IndexedDB save/reload, autosave, the LLM client and request protection,
the answer schema (all block types, limits, invalid inputs), the generation service
(JSON extraction, json_schema→json_object fallback, bounded retry, error mapping),
and the `/api/ask` route. A manual verification checklist follows.

### Manual verification checklist

**Mouse**
- [ ] Draw smooth curves; no jagged straight segments between distant points
- [ ] Highlighter is translucent
- [ ] Eraser removes whole strokes under the cursor, not neighboring ones
- [ ] Undo/redo restores the exact stroke order
- [ ] Refresh mid-session — all strokes return

**Touchscreen**
- [ ] Drawing doesn't scroll the page; sidebar still scrolls normally
- [ ] Sidebar overlays the canvas on small screens; tools remain reachable

**Stylus**
- [ ] Stroke width varies with pressure (if the device reports it)
- [ ] No double-strokes or dropped strokes on pen-down/pen-up
- [ ] Pen eraser end erases (if mapped to button 0)

## Next milestone (recommended): render answers onto the page

1. Selection → context extraction (stroke JSON + offscreen region raster).
2. LLM transport for inference.
3. `insertAIStrokes` to place generated strokes on the AI layer.
4. AI layer management UI: visibility toggle, accept/reject per group, and a `text`
   object type via a `schemaVersion` migration.
