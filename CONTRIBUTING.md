# Contributing to Pellikan

[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![Good first issues](https://img.shields.io/github/issues/philorien/pellikan/good%20first%20issue?label=good%20first%20issues&color=7057ff)](https://github.com/philorien/pellikan/labels/good%20first%20issue)
[![Open issues](https://img.shields.io/github/issues/philorien/pellikan)](https://github.com/philorien/pellikan/issues)

This file is for people who will maintain Pellikan: how the project is put together, what must not be broken, and how
to do the jobs that come up. [README.md](README.md) covers installing and running it. [AGENTS.md](AGENTS.md) is the
short version of the conventions below, written for AI coding agents.

If something here is wrong, fix it in the same PR. These notes are only useful while they are true.

## Ground rules

1. **Licensing comes first.** This app bundles other people's texts. Adding or shipping data you have not checked can
   put the project, and everyone who redistributes it, in breach. See [Data and licensing](#data-and-licensing).
2. **Say what you tested.** The README separates what has been checked from what has not. Keep it that way. Do not write
   "works" for something you did not run. Do not describe the Tauri window as tested until someone has launched it.
3. **Accessibility problems are bugs.** See [ACCESSIBILITY.md](ACCESSIBILITY.md). Do not make the known gaps worse.
4. **Small PRs.** One change per PR, with the checklist in the template filled in honestly.
5. **Community standards.** Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.
6. **AI assistance.** Follow the [AI Policy](AI_POLICY.md). You are accountable for every line of code submitted.

## Set up

Follow [Install from GitHub](README.md#install-from-github). In short:

```bash
npm install
npm run data        # needs network, once. Builds data/build/bible.db and runs the checks
npm run dev         # browser, no Rust needed
```

Before opening a PR, run what applies to your change:

| You changed | Run |
| --- | --- |
| Anything | `npm test` |
| `data/`, `shared/`, a query or the schema | `npm run data:build && npm run data:check` |
| `src-tauri/` or a query | `cd src-tauri && cargo test --lib` |
| The UI | `npm run dev` and use the feature, in light and dark, with the keyboard |
| Translation packs | `npm run data:fetch -- --packs && npm run data:packs` |

On macOS, if `cargo` fails to link with `tapi error: malformed file`, use an older SDK:
`SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk cargo test --lib`.

CI (`.github/workflows/ci.yml`) runs `npm test`, `npm run build`, a release data build, `npm run data:check` and
`cargo test --lib` on Linux for every pull request and push to `main`. It does not run macOS, the Tauri window or any
UI, so it does not replace using the feature yourself. **Watch out:** the Rust tests that need data return early and
*pass* when `bible.db` is missing, so the data build step in that workflow must stay ahead of `cargo test`.

## How the pieces fit

```
shared/                TypeScript used by both the data scripts and the UI (books, references, reference scanning, book import, verse counts, morphology, text)
data/scripts/          fetch.mjs, build-db.mjs, build-packs.mjs, check-db.mjs, translations.mjs, loaders/*
data/schema/           bible.sql (reference DB), user.sql (user DB)
data/queries/*.sql     every query the app runs on bible.db; data/queries/user/*.sql every statement on user.db
src-tauri/src/        db.rs (named queries), packs.rs (translation packs), lib.rs (commands)
server/                dev-only mirror of the Rust side, for `npm run dev` in a browser
app/                   the Nuxt UI
```

The rules that hold it together:

- **The UI never sends SQL.** It sends a query name and parameters. Rust (or the dev server) runs
  `data/queries/<name>.sql`. Parameters are bound by the names the SQL declares, and a missing one is an error.
- **Every query file is registered in `src-tauri/src/db.rs`**, in `QUERIES` (bible.db) or `USER_QUERIES` (user.db).
  `npm run data:check` fails if one is missing.
- **The dev server and the Rust side are twins.** `server/utils/db.ts` and `server/utils/packs.ts` mirror `db.rs` and
  `packs.rs`. Change both or neither.
- **Two kinds of database.** `bible.db` is read-only and ships with the app. `user.db` is the user's. Downloaded
  translations are separate read-only files. Never write to `bible.db`.
- **Canonical verse numbering is English (KJV) with OSIS book ids.** See [Verse numbering](#verse-numbering).
- **User data is in `user.db`** (notes, highlights, tabs, preferences, imported books), behind `useUserData.ts` and `useTabs.ts`.
  Writes are named statements in `data/queries/user/`, run by the `user_query` and `user_batch` commands (or
  `server/utils/userDb.ts` in the dev server, which keeps its own `data/build/user.db`). Components never call those
  directly. Only the theme stays in `localStorage`.

## Your own books

Books a user imports are theirs: they go in `user.db` on that computer and are never part of `bible.db`, a translation
pack, a release, or this repository. Do not commit a sample book you do not have the right to share. The tests build
their text in code.

Plain text and Markdown import works today. The flow is in `app/composables/useDocuments.ts`: extraction runs in the web
view (`shared/doc-import.ts`, in a Worker), Scripture references are found with `scanReferences`
(`shared/reference-scan.ts`), and the result is stored with the `doc*` statements in `data/queries/user/`. A failure
removes the document, so a half-imported book is never visible. Rust and the dev server know nothing about file
formats: a new format (EPUB, DOCX, PDF) is a new extractor that returns an `ImportedDocument`, not new storage. Imported
text is always rendered as text, never as HTML.

## Changing the `user.db` schema

`user.sql` runs on every launch and cannot alter an existing table. To change one: bump the version in `user.sql`, add
`data/schema/migrations/user-N.sql`, and do the upgrade in both `migrate_user` (`src-tauri/src/db.rs`) and
`migrateUser` (`server/utils/userDb.ts`), with tests for both. Never write a migration that can lose rows without
checking first: schema 2 refuses to drop the library tables if a document exists.

## Data and licensing

Every source is recorded in two places that must agree: `DATA_SOURCES.md` (the human record, including known problems)
and the `sources` rows in `build-db.mjs` / `translations.mjs` (which generate the in-app Credits page, so the credit
lines CC BY and CC BY-SA require are shown from the data, not from memory).

Rules:

- **Read the upstream license yourself.** Do not trust a repository's badge, a README summary, or this file.
- **Never commit** `data/sources/`, `data/build/`, an ESV epub, or a built database. They are git-ignored on purpose.
- **The ESV is local-only.** Crossway's terms do not allow redistributing the whole text. Release builds must use
  `npm run data:build:release`, which passes `--no-esv`. An installer built any other way may contain the ESV.
- **ShareAlike.** MorphGNT and Strong's Greek are CC BY-SA, so the built `bible.db` carries ShareAlike obligations.
  Do not add a source whose license conflicts, and do not strip credit lines.
- **Do not hit upstream hosts at runtime.** Fetch once in a build step and cache. The app downloads translation packs
  from our own manifest, never from ebible.org.
- **Pin fragile sources.** Most sources track an upstream default branch (the lock file records what was downloaded).
  Single-maintainer or OCR-derived data, like Thayer's, is pinned to a reviewed commit in `fetch.mjs`.

### Add a data source

1. Check the license (above). If it is unclear, do not add it.
2. Add the download to `data/scripts/fetch.mjs`.
3. Write a loader in `data/scripts/loaders/` as a pure parser plus a thin loader that writes rows, with a unit test
   for the parser using a tiny inline sample (see `reference-data.test.mjs`).
4. Add tables to `data/schema/bible.sql` if needed; add the source row, with license and credit line, in `build-db.mjs`.
5. Add checks to `check-db.mjs` for row counts and a few known facts (for example, "H1254 has a Strong's and a BDB entry").
6. Record it, and anything surprising about the data, in `DATA_SOURCES.md`. Measure problems; do not guess.
7. If the UI reads it, add queries and register them in `db.rs`.

### Add a translation

All Bible texts here are ebible.org USFM zips and share one parser (`loaders/web.mjs`).

1. Confirm it is public domain on ebible.org's copyright page. Add an entry to `data/scripts/translations.mjs`.
2. Choose **bundled or pack**. Bundled (`bundled: true`) goes into `bible.db` and the installer, so it adds to the
   installer size. Everything else should be a pack (`bundled: false`) that users download.
3. Check its versification against the KJV. The build prints any chapter whose last verse differs, and `build-packs.mjs`
   refuses a pack whose chapter structure differs. A text that numbers verses differently needs a mapping table to the
   canonical scheme first. Do not add one without it.
4. Run `npm run data:build` (bundled) or the pack commands, then `npm run data:check`.
5. If the parser throws on an unknown USFM marker, handle the marker in `web.mjs` and add a case to its tests. Unknown
   markers fail loudly on purpose so text is never silently dropped.

### Verse numbering

The scheme is decided: English (KJV) chapter and verse numbers, OSIS book ids. Hebrew numbering is mapped to it through
`versification_map`. The deuterocanon is not loaded. Psalm titles, Malachi 3-4, the Daniel additions, Septuagint psalm
numbering and Catholic numbering all need mapping tables before they can be supported. Adding a second scheme after
users have notes keyed to the first is painful, so do not change it casually.

## Translation packs

Packs are how users get ASV, YLT and Darby. A pack is a gzipped SQLite file with the `bible.db` schema holding one
translation. The app downloads from the manifest URL (default: the `packs` release of this repository), checks the
SHA-256, validates the file, and renames it into the app data folder.

To publish or update packs:

```bash
npm run data:fetch -- --packs      # once; cached in data/sources/
npm run data:packs                 # writes data/build/packs/*.db.gz and manifest.json
gh release upload packs data/build/packs/manifest.json data/build/packs/*.db.gz --clobber --repo philorien/pellikan
```

Upload the manifest and the pack files **together**. The manifest holds each file's checksum, so a mismatched pair makes
every install fail with a checksum error (which is the app doing its job). After uploading, install one from the real
URL to confirm.

Safety rules in `packs.rs` and `packs.ts` (keep them identical): https only (plain `http` for localhost), download and
unpack size caps, ids limited to capitals, digits and underscores because they become file names, validate before
renaming, and delete the temporary file on any failure. Do not weaken them.

## Releasing

There is no installer release process yet. When there is one:

1. `npm run data:build:release` (never a plain `data:build`), then `npm run data:check`.
2. `npm run tauri:build`. The output is unsigned. Distributing to others needs an Apple Developer ID to sign and notarize.
3. Check the installer launches on a clean machine, and that Credits lists every source.
4. Confirm the ESV is not in the bundle: the database inside must have no `ESV` row in `sources`.

## Code style

- Vue 3 `<script setup lang="ts">`. Tailwind utilities using the theme tokens in `app/assets/css/main.css`. Icons from
  `lucide-vue-next`. Never use `v-html`; bind text, and render highlights from the marker characters in search snippets.
- Support both themes. Check contrast with real numbers (see ACCESSIBILITY.md), not by eye.
- Keep `shared/` free of enums and parameter properties: Node imports it directly with type stripping.
- Write plainly in docs and UI text. State what is true and what is not verified.

## Security

The app reads local files and downloads data. Treat both as untrusted: validate before use, cap sizes, never build file
paths from raw input, bind SQL parameters (never concatenate). The Tauri content security policy is currently `null`:
tighten it before any feature handles API keys, and keep keys in the OS keychain, never in a database or `localStorage`.

To report a vulnerability, open a private security advisory on the repository rather than a public issue.

## Where to start

Good first jobs, roughly in order of value:

1. Launch the Tauri window on macOS and fix what breaks.
2. The accessibility fixes listed in [ACCESSIBILITY.md](ACCESSIBILITY.md#known-gaps).
3. Bookmarks: the table exists in `user.db`, but there are no statements or UI for it yet.
4. Linting and formatting config (there is none yet).
