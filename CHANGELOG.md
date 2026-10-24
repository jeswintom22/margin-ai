# Change log

## 2026-10-24T21:59:14+05:30 — API request limits and abuse protection (Bug Fix 4)

- Changed: `app/api/ask/route.ts`, new `lib/ai/requestProtection.ts`, `lib/ai/llm.ts`, `tests/askRoute.test.ts`, `tests/llm.test.ts`, new `tests/requestProtection.test.ts`, `.env.example`, `README.md`, and `AI_USAGE.md`.
- Why: bound untrusted JSON before parsing/paid calls, prevent unlimited local requests, and fail closed rather than imply process-local counters protect multi-instance production deployments.
- What: 32 KiB streamed byte cap and declared-length check; 400/413 errors; configurable process-wide local fixed-window bucket (default 10/minute) with 429/Retry-After; production 503 unless external gateway protection is explicitly attested. No forwarded-header identity trust, new service dependencies, or question/exception logging. Error/answer envelope preserved, responses no-store. Validate upstream timeout configuration (1–120000 ms), preserve fetch timeout handling, and map response-body aborts to 504.
- Production requirement: configure and verify distributed per-client gateway quotas, trusted identity/proxy handling, sanitized JSON throttle responses, and origin lockdown before setting `ASK_EXTERNAL_RATE_LIMIT_ENABLED=true`. The flag does not implement or verify gateway protection. Local fallback is not production abuse protection.
- Validation: focused `npm test -- tests/askRoute.test.ts tests/llm.test.ts tests/requestProtection.test.ts` passed 40/40; `npm test` passed 111/111 across 11 suites; `npm run typecheck`, `npm run lint`, and `npm run build` passed. First build attempt was blocked by a concurrent build; retry passed without removing locks. Tests mock external fetch/limiter dependencies, use an injected clock for window boundaries, and make no paid API calls. Existing Vite CommonJS/ESM config warning remains. Full checks reflect the shared working tree.
- Limitations: no gateway exists in repository configuration, so production protection is not complete until deployment integration is verified. Local quota is global per process and resets on restart. Gateway upload deadlines/concurrency limits, authentication, provider budgets/output caps, and distributed-IP abuse remain deployment responsibilities; no user-facing workflow/UI changes.

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

## 2026-10-24T22:20:00+05:30 — AI answer insertion onto notebook pages

- Changed: document schema v2 adds typed `PageElement` (text/line/rect with groupId+blockId)
  to layers with a v1→v2 migration; `lib/ai/answerLayout.ts` (deterministic layout);
  `drawElement` in render.ts; `insertElements`/`removeElements` history ops;
  `insertAnswer`/`clearAIContent` in useNotebook; "Write to Notebook" in the panel;
  bundled Kalam font (OFL).
- Why: let users review a structured answer and write it onto the page in a
  handwriting-like style, kept on the AI layer and removable without touching user ink.
- Validation: `tsc --noEmit` clean; `eslint` clean; `vitest` 146/146 (11 new); `next build` clean.
- Limitations: glyph widths are estimated (not measured), so wrapping may differ slightly
  from rendered text; LaTeX renders as styled text; insertion undo is recorded on the
  starting page's history.

## 2026-10-24T22:10:00+05:30 — Structured AI response pipeline

- Changed: new `lib/ai/answerSchema.ts` (AnswerDocument zod schema + limits) and
  `lib/ai/answerService.ts` (generateAnswer: json_schema → one json_object fallback,
  JSON extraction, validation, id normalization, unverified metadata);
  `lib/ai/llm.ts` (`chatCompletion` with response_format + providerStatus);
  `app/api/ask/route.ts` now returns AnswerDocument; `lib/ai/types.ts`;
  `components/notebook/AnswerView.tsx` (new) + `AssistantPanel.tsx`; tests updated/added.
- Why: answers must be typed, validated, and renderable — groundwork for writing AI
  content into notebook pages later.
- Validation: `tsc --noEmit` clean; `eslint` clean; `vitest` 135/135 (24 new); `next build`
  clean; `.next/static` contains no key, provider URL, or system prompt.
- Limitations: LaTeX shown as text; untested against a live provider in this session;
  single bounded retry only; no conversation memory.

## 2026-10-24T22:00:00+05:30 — Fix eraser history and pointer cancellation

- Changed: new `lib/drawing/gesture.ts` (`CanvasGesture` pointer state machine);
  `lib/history/history.ts` (new `EraseTransaction`, `removeStrokes`; `revert` restores
  in reverse removal order); `components/canvas/PaperCanvas.tsx` and
  `hooks/useNotebook.ts` rewired; `components/notebook/NotebookApp.tsx` prop wiring;
  new `tests/gesture.test.ts` and `tests/erase.test.ts`.
- Why: a single eraser drag used to record one history op per pointermove hit, so one
  gesture needed many undos (Bug A); pointercancel shared the pointerup path and
  committed incomplete strokes (Bug B).
- Validation: `tsc --noEmit` clean; `eslint` clean; `vitest` 83/83 pass (15 new);
  `next build` clean.
- Limitations: canceling an eraser drag still commits removals already applied (they
  are complete, undoable operations). lostpointercapture is treated as gesture end,
  matching pointerup semantics.

## 2026-10-24T21:55:00+05:30 — Serialized autosave and stricter schema validation

- Changed: `lib/storage/autosave.ts` (new `AutoSaver`), `hooks/useNotebook.ts`,
  `lib/document/schema.ts` (exact version literal, actionable errors),
  `lib/storage/db.ts` (validates stored documents on load), new/expanded tests.
- Why: prevent stale in-flight saves from falsely marking the doc saved; surface
  schema errors on load consistently with import.
- Validation: `tsc --noEmit` clean; `vitest` 68/68 pass at time of change.
- Limitations: pagehide/visibilitychange still cannot guarantee the async IndexedDB
  write completes before the tab closes.

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
