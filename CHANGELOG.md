# Change log

Record each meaningful project change during the event, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## 2026-10-24T21:45:00+05:30 — Basic AI assistant panel (text Q&A)

- Changed: added `app/api/ask/route.ts`, `lib/ai/llm.ts`, `lib/ai/types.ts`, `components/notebook/AssistantPanel.tsx`, `.env.example`, `tests/llm.test.ts`, `tests/askRoute.test.ts`; added an Assistant toggle in `Toolbar.tsx`/`NotebookApp.tsx`; `.gitignore` now allows `.env.example`.
- Why: first step toward the AI tutor. Users can ask a general question and see the answer, while the API key stays on the server.
- Validation: `tsc --noEmit` clean; `npm run lint` clean; `vitest` 39/39 pass (12 new); `npm run build` succeeds with `/api/ask` as a dynamic route; `.next/static` contains no `LLM_API_KEY` or provider URL; with `next start` and no key: POST returns 503 with a config message, an empty question returns 400, GET returns 405, and the page returns 200.
- Limitations: not tested against a live provider (no key available in this session). No conversation memory, streaming, persistence of exchanges, or rate limiting. Answers are not inserted into the notebook.

## 2026-10-24T21:35:00+05:30 — Apply hackathon documentation template

- Changed: `README.md` (project overview filled in), `AGENTS.md`, `AI_USAGE.md`, `CHANGELOG.md`, `SUBMISSION.md`, `RULES.md`, `.github/pull_request_template.md`.
- Why: Adopt the DevDay Kochi participant template so the repo has the required event docs and change record.
- Validation: Template fetched from the organizer repository and applied verbatim where appropriate; markdown reviewed locally.
- Limitations: Team names, repository URL, and final commit SHA in `SUBMISSION.md` still need participant input.

## 2026-10-24T21:15:00+05:30 — Initial notebook MVP

- Changed: Entire application — Next.js 16 scaffold; `lib/document` (typed model, zod schema, versioning); `lib/drawing` (geometry, coords, renderer); `lib/history` (per-page undo/redo ops); `lib/storage` (IndexedDB via `idb`, export/import); `components/canvas` + `components/notebook` (canvas, toolbar, sidebar); `hooks/useNotebook.ts`; `tests/` (27 tests); README.
- Why: First working milestone: handwriting, notebooks/pages, persistence, and an AI-ready layered document model.
- Validation: `npx tsc --noEmit` clean; `npm run lint` clean; `npx vitest run` 27/27 pass; `npm run build` succeeds; `next start` serves HTTP 200.
- Limitations: No palm rejection (browser limitation); eraser removes whole strokes only; no browser E2E tests; multi-tab conflict shows a warning without merge.
