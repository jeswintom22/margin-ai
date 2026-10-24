# Project submission

Complete this file during the hackathon and use it to prepare your submission through the method announced by the organizers. Do not submit your project to the template repository.

## Project

- **Project name:** Margin AI
- **Short description:** A local-first digital handwriting notebook (Xournal++-style) whose document model is designed so an AI tutor can later write solutions onto a user's notes as a separate, non-destructive layer. MVP 1 delivers working pen/highlighter/eraser drawing, multi-notebook and multi-page management, per-page undo/redo, IndexedDB autosave, and JSON export/import — the AI layer exists structurally but no AI features are shipped yet.
- **Code repository URL:** TODO
- **Final submitted implementation commit SHA:** TODO
- **Working demo URL or local demo steps:** Local demo — `npm install && npm run dev`, then open http://localhost:3000.
- **Demo access requirements:** A modern browser (Chrome/Edge/Firefox/Safari). No credentials or backend needed; all data stays in the browser's IndexedDB.

## Participants

Participate solo or in a team of up to 4. Remove unused rows.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js ≥ 20 (developed on v25), npm ≥ 10.
- **Install command:** `npm install`
- **Required environment variable names:** `LLM_API_KEY` (assistant only); optional `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`. See `.env.example`.
- **Start command:** `npm run dev` (or `npm run build && npm start` for production).
- **Demo walkthrough:**
  1. App opens with "My Notebook" and one ruled page.
  2. Draw with the pen; switch color/width; try the highlighter (translucent) and eraser.
  3. Use `Ctrl+Z`/`Ctrl+Y` or toolbar buttons to undo/redo.
  4. Add pages (+ Page), rename/reorder/delete them in the sidebar; create a second notebook and switch back.
  5. Refresh the browser — all strokes persist.
  6. Use Export to download the notebook JSON, then Import it via the sidebar.
  7. Try the Select tool (drag a rectangle) and Delete to remove selected strokes.
  8. With `LLM_API_KEY` set, click **Assistant**, ask a question, and read the answer in the panel.
- **Checks performed and results:** `tsc --noEmit` clean, `eslint` clean, `vitest` 39/39 passing, `next build` clean, production server smoke-tested (HTTP 200).
- **Known limitations or incomplete features:** No palm rejection (browser limitation); eraser removes whole strokes; no multi-tab merge (warning only); AI features intentionally out of scope for MVP 1; no E2E browser tests.
- **Libraries, APIs, and public datasets used:** Next.js 16, React 19, Tailwind CSS 4, `idb` (IndexedDB wrapper), `zod` (import validation); dev: Vitest, fake-indexeddb. No external APIs or datasets.
- **AI usage record:** [AI_USAGE.md](AI_USAGE.md)
- **Development change log:** [CHANGELOG.md](CHANGELOG.md)

## Submission checklist

- [ ] The project implementation started from scratch at the event.
- [ ] I participated solo or with no more than 4 team members in total.
- [x] Codex was used during development and its usage is documented.
- [ ] The code repository URL, short description, and working demo are provided.
- [x] README setup and demo instructions match the submitted code.
- [x] Actual checks and known limitations are documented.
- [ ] Meaningful changes are documented and committed throughout development.
- [ ] The final implementation is committed and pushed, and its SHA is recorded above.
- [x] No credentials or private data are included in the repository or demo instructions.
- [ ] The organizers' announced submission method and timing have been followed.

Event reference: [DevDay Exchange Community: Kochi on Luma](https://luma.com/z10nz8gp). The event wraps up by **10:00 AM IST on 11 October 2026**.
