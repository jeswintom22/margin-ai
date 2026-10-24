# Change log

Record each meaningful project change during the event, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## 2026-10-24T21:56:00+05:30 — Persistence and autosave reliability (Bug Fix 2)

- Changed: new `lib/storage/autosave.ts` (`AutoSaver`); rewired persistence in `hooks/useNotebook.ts`; new `tests/autosave.test.ts` (9 tests). `autosave.ts`/`autosave.test.ts` were included in a concurrent workstream's commit `4d7461d`; this change adds the mount-effect saver creation required by the Next.js 16 react-hooks lint rules.
- Why: the old `persist()` cleared the dirty flag before the IndexedDB write resolved and set "saved" unconditionally, so an edit during an in-flight save was falsely reported as persisted; `beforeunload` started async work with no retry/serialization; each save leaked a `BroadcastChannel`.
- What: saves are serialized through `AutoSaver` — a `flush()` during an in-flight write does not start a concurrent put, and edits made mid-save keep the doc dirty and trigger a follow-up save of the latest state. Status is "saving" while any write is pending, "saved" only after `db.saveNotebook` resolves with no newer edits, and "error" on failure (dirty retained, retry after the debounce interval). Pending debounced saves flush early on `pagehide`, `beforeunload`, and `visibilitychange`→hidden (no completion guarantee). The post-save `BroadcastChannel` is now closed after `postMessage`.
- Validation: `npx vitest run` 68/68 (9 new autosave tests); `npm run typecheck`, `npm run lint` (targeted on changed files), and `npm run build` all pass.
- Limitations: lifecycle flushes are best-effort — the browser may still kill the page before IndexedDB finishes; no claim of persistence after process termination. A save already in flight when "discard & reload" runs can still complete its write before the reload replaces in-memory state. Debounce (800 ms) and document format unchanged.

## 2026-10-24T21:52:13+05:30 — Explicit document version policy (Bug Fix 3)

- Changed: `lib/document/schema.ts`, `lib/storage/db.ts`, `tests/document.test.ts`, `tests/storage.test.ts`, `README.md`, and `AI_USAGE.md`. A concurrent workstream included the implementation/tests in commit `4d7461d`; this follow-up records the migration policy and verification.
- Why: remove the fallback that silently relabeled unsupported older documents and make IndexedDB loading/listing share import validation. Version 1 remains current and oldest; no historical formats or AI writing fields were invented. Direct migration calls now validate input and the complete final v1 document.
- Policy: reject malformed/unsupported older versions, give future versions an update instruction, preserve modeled v1 data and existing page defaults, and never rewrite stored data on load. README explains source validation, explicit consecutive steps, output validation after every step, final validation, deterministic transformations, and tests required for v2.
- Validation: regression run before implementation reproduced 15 failures; targeted document/storage run then passed 29/29. After adding a v1-default compatibility test, `npm test` passed 68/68 across 8 suites; `npm run typecheck` and `npm run build` passed. Targeted ESLint on all four changed TypeScript files passed. `npm run lint` initially failed with five ref/purity errors in concurrently edited `hooks/useNotebook.ts`; a repeat after concurrent edits failed with one ref-access error and one unused-variable warning in `components/canvas/PaperCanvas.tsx`, outside this task. Tests report an existing Vite config CommonJS/ESM warning. Full-suite results reflect concurrent work in the shared tree.
- Limitations: v1 is the only supported format, so there are no real migration transformations to test yet. Invalid/unsupported records also cause notebook listing to fail rather than being silently skipped. Loads do not persist normalized data. No UI or AI writing changes.

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
