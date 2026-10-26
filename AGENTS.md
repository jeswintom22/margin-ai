<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Commands: `npm install`, `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run typecheck`, `npm run lint`.
- The notebook document model lives in `lib/document/` — keep `author` separation between `user` and `ai` layers; never merge AI content into the user layer. Layers hold `strokes` (user ink) and `elements` (typed AI content: text/line/rect).
- Stroke coordinates are document-space (page units), not screen pixels; use `lib/drawing/coords.ts` for conversion. Document schema is versioned (`SCHEMA_VERSION`); changes need a migration step in `lib/document/schema.ts`.
- Undo/redo uses `PageHistory` in `lib/history/`; editing features must be reversible operations (`addStroke`, `eraseStrokes`, `insertElements`, `removeElements`).
- AI calls go through `app/api/ask/route.ts` → `lib/ai/answerService.ts` → `lib/ai/llm.ts`; never import `llm.ts`/`answerService.ts` from client components or expose `LLM_*` env vars to the browser. Model output is validated by `lib/ai/answerSchema.ts` before use; insertion lays answers out via `lib/ai/answerLayout.ts`.
- AI "hand" text renders as real pen strokes via `lib/drawing/strokeFont.ts` (glyphs in `glyphs.json`, rebuilt by `scripts/build-glyphs.mjs`), driven by a live `HandProfile` learned from the user's ink in `lib/drawing/handStyle.ts` and published in `useNotebook` (`setHandProfile` + repaint bump). `sizeFactor`/`inkColor` are frozen into elements at insertion; slant/jitter/pen-width/pressure are render-time cosmetics — keep it that way so layout stays deterministic.
- **Commit after every step** and **push after every commit** (owner preference) to `origin/main`. Never force-push; if rejected, fetch and merge first.
