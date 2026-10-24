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
- **Assistant panel (text Q&A):** the toolbar's **Assistant** button opens a side panel.
  Questions go to `POST /api/ask`, a Next.js route handler that calls one
  OpenAI-compatible chat completions API. The API key is read on the server only and never
  sent to the browser. Answers are plain text, kept in memory for the session, and are not
  written into the notebook yet.
- **Known limitations:** No palm rejection (browsers don't expose reliable palm data);
  eraser removes whole strokes only; multi-tab editing warns but doesn't merge;
  no E2E browser tests yet. Assistant: no conversation memory (each question is
  independent), exchanges are lost on refresh, no streaming, no rate limiting on
  `/api/ask` (fine locally, but add it before any public deployment), and answers are
  not yet inserted onto pages.
- **Libraries, APIs, and public datasets used:**
  [Next.js](https://nextjs.org), [React](https://react.dev),
  [Tailwind CSS](https://tailwindcss.com), [idb](https://github.com/jakearchibald/idb),
  [zod](https://zod.dev), [Vitest](https://vitest.dev),
  [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB).
  External API: one OpenAI-compatible chat completions provider of your choice (configured
  via `LLM_BASE_URL`), used only by the assistant. No datasets.

See [AI_USAGE.md](AI_USAGE.md) for AI assistance and [CHANGELOG.md](CHANGELOG.md) for the development record.

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
app/api/ask/route.ts    POST endpoint: validates question, calls the LLM, maps errors
lib/ai/llm.ts           server-only OpenAI-compatible client (config from env)
lib/ai/types.ts         request/response types and validation shared with the client
components/notebook/AssistantPanel.tsx   question box + answer list
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
- **Schema versioning.** `schemaVersion` + `migrateNotebook()` provide the
  forward-migration hook; imports are validated and newer versions rejected.
- **History scope.** Undo/redo stacks are per page; page structural ops use
  confirmations (documented trade-off).

### AI-readiness hooks (implemented, no UI)

- `selectInRect(rect)` → region/stroke selection
- `insertAIStrokes(strokes)` → write AI-authored strokes at document coords
- `setAILayerVisible(bool)` → toggle the AI layer
- `author` on every stroke/layer distinguishes provenance; cropped region capture is
  an offscreen `renderPage` call away.

## Testing

39 tests cover stroke geometry, coordinate conversion under resize, undo/redo,
eraser restoration, validation/migration, user↔AI layer separation, IndexedDB
save/reload, the LLM client (request shape, error mapping, timeouts, malformed
responses), and the `/api/ask` route (validation, missing key, success). A manual verification checklist for mouse/touch/stylus follows.

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

## Next milestone (recommended): AI handwriting layer

1. Selection → context extraction (stroke JSON + offscreen region raster).
2. LLM transport for inference.
3. `insertAIStrokes` to place generated strokes on the AI layer.
4. AI layer management UI: visibility toggle, accept/reject per group, and a `text`
   object type via a `schemaVersion` migration.
