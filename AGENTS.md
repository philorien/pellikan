# AGENTS.md

Guidance for AI coding agents working in Pellikan. Humans: see [README.md](README.md) for setup and status.
Maintainer workflow, data and licensing rules: [CONTRIBUTING.md](CONTRIBUTING.md). Accessibility rules and known gaps:
[ACCESSIBILITY.md](ACCESSIBILITY.md). Policy on AI contributions: [AI_POLICY.md](AI_POLICY.md).

## What this is

A local-first, open source Bible study desktop app. Tauri 2 (Rust) shell, Nuxt 4 SPA (`ssr: false`), Tailwind v4,
SQLite with FTS5. Reference text lives in a read-only `bible.db`; user data goes in a separate `user.db`.

## Commands

```bash
npm install
npm run data          # fetch sources, build data/build/bible.db, run checks (needs network, ~41 MB)
npm run dev           # browser at localhost:3000, queries served by server/api/query/ and server/api/user/
npm run tauri:dev     # desktop app (needs Rust and Xcode CLT on macOS)
npm test              # node:test unit tests for data loaders and shared/
npm run data:check    # database integrity checks
npm run data:fetch -- --packs && npm run data:packs   # build downloadable translation packs into data/build/packs/
npm run build         # static site (nuxt generate)
```

Node >= 22.18 is required: the data scripts use `node:sqlite` and run TypeScript natively. `bible.db` must exist
before the UI shows anything; build it with `npm run data`.

## Layout

- `app/` Nuxt UI. `pages/` (read/[book]/[chapter], search, notes, highlights, library, credits), `components/`,
  `composables/` (`useBible`, `useTabs`, `useTheme`, `useUserData`), `utils/types.ts`.
- `shared/` TypeScript used by both the UI and the data scripts: books, reference parsing, morphology decoding, text.
- `data/queries/*.sql` every query the app runs on `bible.db`, and `data/queries/user/*.sql` every statement it runs
  on `user.db` (reads and writes). **Single source of truth** for Rust and the dev server.
- `data/schema/` `bible.sql` (reference DB) and `user.sql` (user DB, idempotent).
- `data/scripts/` fetch, build, check, `translations.mjs` (translation catalog), and `loaders/`: USFM (WEB, BSB, KJV),
  OSHB, MorphGNT, optional ESV epub, `sword.mjs` (CrossWire module reader), `lexicon`, `dictionary`, `commentary`,
  `crossrefs`, `markup`.
- `server/` dev-only API routes (`/api/query/*`, `/api/user/*`, `/api/translations/*`) and DB/pack helpers.
- `src-tauri/src/` `db.rs`, `lib.rs`, `main.rs`: opens both DBs, exposes `query` (bible.db, read-only) and
  `user_query` / `user_batch` (user.db).
- `.agents/skills/` design skills (Impeccable). Not app code.

## Conventions and invariants

- **The UI never sends SQL.** It calls a named query; the backend runs `data/queries/<name>.sql`. To add a query,
  add the file and make sure `data:check` prepares it. Keep parameters named and validate the name against the
  allowlist, never build paths from raw input.
- **Two databases, never mixed.** Do not write to `bible.db`. User data (notes, highlights, bookmarks, imports,
  settings) belongs in `user.db`. The two query lists are separate (`QUERIES` and `USER_QUERIES` in `db.rs`): a user
  statement cannot run on `bible.db` or the reverse.
- **User data goes through `useUserData.ts`.** Notes, highlights, preferences and the open tabs are in `user.db`,
  written with the named statements in `data/queries/user/` via `userQuery` / `userBatch` (`useBible.ts`). Components
  call the composables (`useUserData.ts`, `useTabs.ts`), never `userQuery` directly. Use `userBatch` when several rows
  must land together. Notes and highlights are written before the screen shows them; a failed save sets `error`
  (shown by `app.vue`) and must never look saved. The first run copies old `localStorage` data across once
  (`legacyOps`). Only the theme stays in `localStorage`, because it is read before first paint. Bookmarks have a
  table but no statements or UI yet.
- **The dev server keeps its own `user.db`** at `data/build/user.db` (`PELLIKAN_USER_DB` overrides it), mirrored in
  `server/utils/userDb.ts`. Keep it in step with `db.rs`, like the packs twin. Its `migrated.localStorage` marker is
  shared by every origin (port) the dev server runs on, so only the first origin's `localStorage` is copied in.
- **New Tauri commands go in `handlers()` in `lib.rs`**, the one list `run()` and the IPC tests share. Test them
  through `ipc_tests` (mock runtime) with the same argument shape the web view sends.
- **Canonical verse numbering** is English (KJV) with OSIS book ids. The KJV is the reference versification; every
  bundled translation is checked against it in `build-db.mjs`. A text that numbers verses differently needs a mapping
  table first (see DATA_SOURCES.md). Decide this before adding sources, not after.
- **Bundled vs on demand.** WEB, BSB and KJV ship inside `bible.db`. Other translations are `bundled: false` in
  `data/scripts/translations.mjs` and are downloaded by the app. Do not make the app fetch from ebible.org at
  runtime per user: fetch once at build time, cache, and serve prebuilt packs.
- **Downloaded translations** are packs (one SQLite file each, same schema as `bible.db`, one translation) installed by
  `src-tauri/src/packs.rs` and mirrored for the browser dev server in `server/utils/packs.ts`. Keep the two in step:
  same URL rules, same size caps, same validation. Queries listed in `PACK_QUERIES` run on the pack's connection; anything
  that needs `words`, lexicons or cross-references must stay on `bible.db`. Never add a code path that downloads from
  ebible.org at runtime.
- **Release builds** use `npm run data:build:release` (no ESV). A plain build includes the ESV if the epub is present.
- **References** use canonical book ids 1..66, OSIS ids in routes (`/read/Rom/8`), and English verse numbering.
  Use `shared/books.ts` and `shared/reference.ts`; do not re-implement parsing.
- **English words are intentionally not clickable.** WEB Strong's tags on English words are unreliable in the OT
  (measured, see DATA_SOURCES.md). Word study goes through the Hebrew and Greek words.
- **Secrets:** AI provider API keys, when added, go in the OS keychain, never a database or `localStorage`. Tighten
  the Tauri CSP (currently `null`) before any AI feature ships.
- **Licensing is a hard constraint.** `data/sources/` and `data/build/` are git-ignored on purpose. Never commit the
  ESV epub or a database that contains it. Do not add a data source without recording its license in
  DATA_SOURCES.md. The built DB includes CC BY-SA (MorphGNT) material.
- **Do not edit generated or ignored output:** `.nuxt/`, `.output/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`.
- Update the Credits/`sources` data (via `build-db.mjs` and DATA_SOURCES.md) when sources change.

## Style

- Vue 3 `<script setup lang="ts">`, Tailwind utility classes using the theme tokens in `app/assets/css/main.css`
  (`bg-surface`, `text-muted`, `border-line`, `text-accent`). Icons from `lucide-vue-next`.
- Support light and dark themes; check both when touching colors.
- Prose and docs: plain, no marketing tone, no em dashes. State what was and was not verified.

## Verification

- Data or loader changes: `npm test` and `npm run data:check`.
- UI changes: run `npm run dev` and exercise the page in a browser. Type checks passing is not the same as the
  feature working.
- The Rust crate compiles and its tests pass on the Mac (with the SDK workaround above). The Tauri window itself has not
  been launched. Say so rather than claiming it works.
- Rust: `cd src-tauri && cargo test` (tests run against the real `bible.db`). On this Mac the default macOS 27 SDK fails
  to link; use `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk cargo test`.
