## What and why

<!-- What does this change, and why? Link the issue if there is one. One change per PR. -->

## Kind of change

- [ ] Bug fix
- [ ] UI or interaction
- [ ] New or changed data source (translation, lexicon, commentary, cross-references)
- [ ] Schema, query or Rust change
- [ ] Docs only
- [ ] Other:

## How I checked it

<!-- Paste the relevant results. "It compiles" is not a check for UI or data changes. -->

- [ ] `npm test` passes
- [ ] `npm run data:check` passes (needed if you touched `data/`, `shared/` or a query)
- [ ] `cd src-tauri && cargo test --lib` passes (needed if you touched `src-tauri/` or a query)
- [ ] I ran the app (`npm run dev` or `npm run tauri:dev`) and used the thing I changed
- [ ] What I could **not** test, and why:

## If this touches the UI

- [ ] Checked in **light and dark** themes
- [ ] Usable with the **keyboard only** (tab order, visible focus, Escape closes things)
- [ ] New controls have an accessible name, and icon-only buttons have an `aria-label`
- [ ] Text has at least 4.5:1 contrast (3:1 for large text and controls); I did not use `text-faint` for text that matters
- [ ] Touch targets are at least 24 by 24 px (44 by 44 on mobile where possible)
- [ ] Respects reduced motion
- [ ] Screenshots (before and after) attached

See [ACCESSIBILITY.md](../ACCESSIBILITY.md) for the known gaps; do not make them worse.

## If this touches data or licensing

- [ ] The source's license is recorded in `DATA_SOURCES.md` and in the `sources` rows in `build-db.mjs` (or `build-packs.mjs`)
- [ ] I read the upstream license myself and the required credit line appears on the Credits page
- [ ] No copyrighted text (such as the ESV epub) or built database is committed
- [ ] Verse numbering maps to the canonical scheme (English/KJV, OSIS book ids); the build's check still passes
- [ ] Release builds still exclude the ESV (`npm run data:build:release`)

## If this touches schema, queries or packs

- [ ] New query files are registered in `src-tauri/src/db.rs` (`data:check` fails if not)
- [ ] The UI still sends a query **name** and parameters, never SQL
- [ ] `bible.db` schema changes bump the version in `bible.sql`, `build-db.mjs` and `check-db.mjs` together
- [ ] `user.db` schema changes bump the version in `user.sql`, add `data/schema/migrations/user-N.sql`, and upgrade both `migrate_user` (`db.rs`) and `migrateUser` (`userDb.ts`), with tests
- [ ] Changes to translation-pack handling are made in both `src-tauri/src/packs.rs` and `server/utils/packs.ts`

## Docs

- [ ] README, `DATA_SOURCES.md` or `AGENTS.md` updated where this changes what they say
- [ ] I did not claim anything works that I did not run

<!-- Optional: if an AI tool wrote a substantial part of this, say so. Reviewers read it differently, not less seriously. -->
