<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Commands: `npm install`, `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run typecheck`, `npm run lint`.
- The notebook document model lives in `lib/document/` — keep `author` separation between `user` and `ai` layers; never merge AI content into the user layer. Layers hold `strokes` (user ink) and `elements` (typed AI content: text/line/rect).
- Stroke coordinates are document-space (page units), not screen pixels; use `lib/drawing/coords.ts` for conversion. Document schema is versioned (`SCHEMA_VERSION`); changes need a migration step in `lib/document/schema.ts`.
- Undo/redo uses one notebook-wide `NotebookHistory` in `lib/history/`; editing features must be reversible operations (`addStroke`, `eraseStrokes`, `insertElements`, `removeElements`, `setLayerVisibility`). Deleting a page prunes history entries that reference it.
- AI calls go through `app/api/ask/route.ts` → `lib/ai/answerService.ts` → `lib/ai/llm.ts`; never import `llm.ts`/`answerService.ts` from client components or expose `LLM_*` env vars to the browser. Model output is validated by `lib/ai/answerSchema.ts` before use; insertion lays answers out via `lib/ai/answerLayout.ts` / `markLayout.ts` (check marks). `LLM_MOCK=true` gives a deterministic provider in dev/test only.
- The voice assistant lives in `hooks/useVoiceAssistant.ts` + `components/notebook/VoiceDock.tsx`; transcripts are parsed by `lib/ai/commands.ts` and `window.__margin.run(text)` is the Playwright hook (same code path).
- App menu: one `MenuSection` tree built in `NotebookApp` feeds `components/menu/MenuBar` (desktop dropdowns) and `MobileSheet` (mobile bottom sheet) — add items there once. Zoom items reach `PaperCanvas` through its `apiRef`.
- **v2 editor (`/v2`, Xournal++-style rebuild, in progress)**: document model v4 in `lib/xdoc/` uses PDF points; every mutation is a `Command` in `lib/engine/history.ts` applied through `Editor.run()`/`record()`. Elements are immutable values (replace, don't mutate) so commands can hold references. Input policy lives in `lib/engine/input.ts` (pure, unit-tested). Rendering never goes through React state: page canvases subscribe to `editor.subscribePages`. v2 storage is a separate IndexedDB (`margin-notebook-v4`). Clean-room: never copy Xournal++ source.
- **Commit after every step** on a feature branch, push the branch, and open a PR to `main` (owner preference). Never push directly to `main`; never force-push.
- AI "hand" text renders as real pen strokes via `lib/drawing/strokeFont.ts` (glyphs in `glyphs.json`, rebuilt by `scripts/build-glyphs.mjs`), driven by a live `HandProfile` learned from the user's ink in `lib/drawing/handStyle.ts` and published in `useNotebook` (`setHandProfile` + repaint bump). `sizeFactor`/`inkColor` are frozen into elements at insertion; slant/jitter/pen-width/pressure are render-time cosmetics — keep it that way so layout stays deterministic.
