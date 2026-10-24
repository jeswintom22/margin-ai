# AI usage record

Use Codex during the hackathon and briefly document its actual contribution here. Add a row after each meaningful task or milestone. Keep summaries concise and omit secrets, private data, and full chat transcripts.

## Event build log

| Date and time with timezone | Tool / model, if known | Task | Assistance and affected files | Human review / corrections | Validation and result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24T20:40+05:30 | Devin (Cognition) | Scaffold + full MVP implementation | Scaffolded Next.js app and implemented the entire notebook: document model (`lib/document/`), drawing engine (`lib/drawing/`, `components/canvas/`), undo/redo (`lib/history/`), IndexedDB persistence (`lib/storage/`), UI (`components/notebook/`), app store (`hooks/useNotebook.ts`), tests (`tests/`) | Pending | `tsc --noEmit`, `eslint`, `vitest` (27/27), `next build` all passed; prod server smoke-tested HTTP 200 |
| 2026-10-24T21:35+05:30 | Devin (Cognition) | Apply hackathon template docs | Filled README, RULES, AGENTS, CHANGELOG, AI_USAGE, SUBMISSION, PR template for this project | Pending | Manual review of rendered markdown; links checked locally |
| 2026-10-24T21:45+05:30 | Devin (Cognition) | Basic AI assistant panel | Added server route `app/api/ask/route.ts`, LLM client `lib/ai/llm.ts`, shared types `lib/ai/types.ts`, `AssistantPanel.tsx`, toolbar toggle, `.env.example`, and 12 tests | Pending | tsc, lint, vitest 39/39, and build pass; route smoke-tested without a key (503/400/405). Not tested against a live LLM |

Notes:

- The AI agent (Devin, powered by Adaptive) authored essentially all application code; the human directed requirements and reviewed the result.
- Known corrections applied during the session: fixed a dead `widthAt` helper in `lib/drawing/render.ts`, fixed `fake-indexeddb` missing globals in `tests/storage.test.ts`, and refactored ref-access-during-render to satisfy Next.js 16's react-hooks lint rules.
