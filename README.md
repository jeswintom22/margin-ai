# Margin AI — Digital Notebook (MVP 1)

A local-first, Xournal++-inspired handwriting notebook built on Next.js. Designed so an
AI tutor can later write into the same document model as a separate, non-destructive
layer — no AI features are implemented in this milestone.

## Commands

```bash
npm install        # install dependencies
npm run dev        # dev server (http://localhost:3000)
npm run build      # production build
npm start          # serve production build
npm test           # unit + storage tests (Vitest)
npm run typecheck  # strict TypeScript check
npm run lint       # ESLint
```

## Features

- Freehand drawing with mouse, touch, and stylus (Pointer Events, pressure-aware width)
- Pen, highlighter (translucent), eraser, and rectangular selection tools
- Undo/redo per page (operation-based, redo invalidated on new edits)
- Multiple notebooks; pages can be added, renamed, reordered, deleted (with confirm)
- Paper styles: blank, ruled, grid
- Autosave to IndexedDB (debounced), restore on reload, save-status indicator
- JSON export/import with schema validation and version migration
- Multi-tab conflict warning; storage-unavailable banner; error states
- Responsive layout: collapsible sidebar, scrollable toolbar on small screens
- Keyboard shortcuts: `P` pen, `H` highlighter, `E` eraser, `S` select,
  `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo, `Delete` removes selection, `Esc` clears it

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
hooks/useNotebook.ts    app store: doc state, tools, autosave, conflicts, AI ops
tests/                  Vitest suites (geometry, coords, history, document, storage)
```

### Document model decisions

- **Page-space coordinates.** Strokes store document units (1 unit = 1 CSS px at fit
  scale 1). Pages have a fixed intrinsic size (794×1123, A4@96dpi), so strokes survive
  resize, DPR change, and future zoom.
- **Layers separate user and AI content.** Every page has a `user` layer; AI strokes are
  inserted via `insertAIStrokes()` into a dedicated `ai` layer that can be hidden,
  edited, or deleted independently. User strokes are never merged or overwritten.
- **Erasing is reversible.** `eraseStrokes` ops record removed strokes + indices in
  `PageHistory` and append an `EraserOperation` provenance record to the page. Undo
  restores strokes at their original positions and removes the log entry.
- **Schema versioning.** `schemaVersion` on the notebook + `migrateNotebook()` provide
  the forward-migration hook; `parseExportFile` validates imports and rejects newer
  versions.
- **History scope.** Undo/redo stacks are per page (`Map<pageId, PageHistory>`).
  Stroke-level ops are undoable; page add/delete are confirmed instead (documented
  trade-off — keeps history linear and simple).

### AI-readiness hooks (implemented, no UI)

- `selectInRect(rect)` + selection overlay → region/stroke selection
- `insertAIStrokes(strokes)` → write AI-authored strokes at document coords
- `setAILayerVisible(bool)` → toggle the AI layer
- `author` field on every stroke and layer distinguishes provenance
- Cropped region capture is trivial: render `page` to an offscreen canvas clipped to a
  rect using `renderPage` (the model has no raster dependency).

## Testing

27 unit/storage tests cover stroke geometry, coordinate conversion under resize,
undo/redo semantics, eraser restoration, document validation/migration, layer
separation, and IndexedDB save/reload. Browser-based E2E tests were deferred — the
drawing loop is verified by the manual checklist below.

### Manual verification checklist

**Mouse**
- [ ] Draw smooth curves; no jagged straight segments between distant points
- [ ] Highlighter is translucent and doesn't obscure ruled lines completely
- [ ] Eraser removes whole strokes under the cursor, not neighboring ones
- [ ] Undo/redo restores the exact stroke order
- [ ] Refresh the page mid-session — all strokes return

**Touchscreen**
- [ ] Drawing doesn't scroll the page; sidebar still scrolls normally
- [ ] Pinch/scroll outside the canvas still navigates
- [ ] Sidebar overlays the canvas on small screens; tools remain reachable

**Stylus**
- [ ] Stroke width varies with pressure (if the device reports it)
- [ ] No double-strokes or dropped strokes on pen-down/pen-up
- [ ] Eraser end of pen (if mapped to button 0) erases

## Known limitations

- **No true palm rejection.** Browsers don't expose reliable palm-contact data.
  `touch-action: none` on the canvas blocks all touch scrolling inside the page area;
  navigation is via the sidebar/toolbar. A future "pen-only mode" could ignore
  `pointerType === "touch"` while a pen is in range.
- **Multi-tab editing** shows a conflict banner with a "reload" escape hatch; there is
  no merge.
- **Eraser removes whole strokes** (no partial/segment splitting yet).
- **Undo covers stroke ops**; page structural ops use confirmations.
- **No E2E browser tests** in this milestone.
- Note: `vitest@5` prints an EBADENGINE warning on Node 25; tests run normally.

## Next milestone (recommended): AI handwriting layer

1. Selection → context extraction: collect selected strokes + neighbors, rasterize the
   region via an offscreen `renderPage` call.
2. Inference transport: send context (strokes as JSON and/or PNG crop) to an LLM.
3. Insertion: receive stroke JSON (same `Point[]` format) → `insertAIStrokes` on the
   page's AI layer, positioned at document coordinates.
4. Management UI: AI layer visibility toggle, accept/reject per AI stroke group,
   handwriting-style font fallback for rendered math/text (model already supports
   adding a `text` object type via `schemaVersion` migration).
