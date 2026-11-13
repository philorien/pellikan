<p align="center">
  <img src="public/pellikanreadme.png" alt="Pellikan logo" width="240">
</p>

# Pellikan

[![License: AGPL v3](https://img.shields.io/github/license/philorien/pellikan)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/philorien/pellikan?include_prereleases&label=release)](https://github.com/philorien/pellikan/releases)
[![Open issues](https://img.shields.io/github/issues/philorien/pellikan)](https://github.com/philorien/pellikan/issues)
[![Open pull requests](https://img.shields.io/github/issues-pr/philorien/pellikan)](https://github.com/philorien/pellikan/pulls)
[![Last commit](https://img.shields.io/github/last-commit/philorien/pellikan)](https://github.com/philorien/pellikan/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![Good first issues](https://img.shields.io/github/issues/philorien/pellikan/good%20first%20issue?label=good%20first%20issues&color=7057ff)](https://github.com/philorien/pellikan/labels/good%20first%20issue)
[![Roadmap](https://img.shields.io/badge/roadmap-GitHub%20Project-blue)](https://github.com/users/philorien/projects/2)

[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-FTS5-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![Accessibility target: WCAG 2.2 AA](https://img.shields.io/badge/a11y_target-WCAG_2.2_AA-informational)](ACCESSIBILITY.md)

A local-first Bible study app in the spirit of SWORD and Logos. Open source. Your notes, highlights and downloaded
texts live on your computer. Nothing about your reading is sent anywhere.

![Pellikan interface reading Luke 24 with commentary, cross-references, and Greek word study](public/screenshot.jpg)

> **Status: early.** A preview installer for macOS (Apple Silicon) is available from the
> [v0.0.1 release](https://github.com/philorien/pellikan/releases/tag/v0.0.1) (see [Download prebuilt app](#download-prebuilt-app-macos-apple-silicon)).
> You can also build Pellikan from source to run in a browser or as a desktop app (see [Build from source](#build-from-source)).
> The packaged app is new, unsigned, and has had limited real-world testing.
> See [What has been tested](#what-has-been-tested) for current testing status.

## Why Pellikan

The app is named for [Konrad Pellikan](https://en.wikipedia.org/wiki/Konrad_Pellikan) (1478 to 1556), a Franciscan friar
from Rouffach in Alsace who became a Reformation-era scholar in Basel and Zurich. He was born Konrad Kürsner; his uncle
Jodocus Gallus gave him the Latin name Pellicanus.

Three things about him are close to what this project is trying to do:

- **He worked in the original languages.** Johannes Reuchlin gave him hints for learning Hebrew and lent him a
  grammar, and Pellikan went on to write what the article credits as the first Hebrew grammar by a Christian. This app
  puts the Hebrew, Aramaic and Greek, with lexicons and morphology, one click from the English.
- **He read the whole Bible with a commentator's patience.** His _Commentaria Bibliorum_ (seven volumes, Zurich,
  1532 to 1539) is praised for its judgment about the text and for reading historically rather than typologically.
  The app sets Matthew Henry's commentary, cross-references and dictionaries beside the passage so the text and the
  help for reading it are in one place.
- **He was a teacher.** He taught Hebrew, Greek and theology in Basel and, from 1526 until his death, held the chair of
  Hebrew and Greek at the Carolinum in Zurich. This app is meant to be a study companion in that spirit.

The biography above is summarized from the linked Wikipedia article, which marks some of its own details as unsourced.

## What it does

- **Read** with a passage picker, command palette (`Cmd/Ctrl+K`), browser-style tabs, adjustable text size, red-letter
  toggle, print, and light, dark or system themes.
- **Six translations offline.** WEB, BSB and KJV are built in. ASV, YLT and Darby download once from the Library page
  (3 to 7 MB each), are verified against a checksum, and then work offline. An ESV is possible if you supply your own
  licensed epub (see [DATA_SOURCES.md](DATA_SOURCES.md)).
- **Original languages.** The Hebrew, Aramaic and Greek words of the selected verse with decoded morphology, and every
  other place a word is used.
- **Lexicons.** Strong's, Brown-Driver-Briggs and Thayer's in Word Study.
- **Commentary and cross-references.** Matthew Henry beside the passage. Cross-references from OpenBible.info (ranked by
  votes) and the Treasury of Scripture Knowledge.
- **Dictionaries.** Easton's and Smith's, searchable.
- **Study guide, notes and highlights.** Section headings, footnotes and cross-references for the chapter; notes and
  four highlight colors per verse, with overview pages.
- **Full-text search** across the selected translation.

Not built yet: importing your own books (EPUB, PDF, DOCX), AI-assisted search, signed installers. See the
[roadmap](#roadmap).

## Install from GitHub

You can download the prebuilt app for macOS (Apple Silicon) or build from source.

### Download prebuilt app (macOS Apple Silicon)

An early preview release is available for Apple Silicon Macs (M1/M2/M3/M4):

1. Go to the [v0.0.1 release](https://github.com/philorien/pellikan/releases/tag/v0.0.1) on GitHub.
2. Under **Assets**, download **`Pellikan_0.0.1_aarch64.dmg`** (~78 MB).
3. Open the disk image and drag **Pellikan** into your **Applications** folder.
4. **macOS Gatekeeper:** Because this preview build is unsigned, macOS will say it cannot verify the developer on first launch:
   - Right-click (or Control-click) `Pellikan.app` in `/Applications`, choose **Open**, and click **Open** in the confirmation dialog.
   - If macOS still refuses to run it, open Terminal and clear the quarantine attribute:
     ```bash
     xattr -dr com.apple.quarantine /Applications/Pellikan.app
     ```

> **Note on translation packs:** The separate [`packs`](https://github.com/philorien/pellikan/releases/tag/packs) release on GitHub holds the optional translation packs (ASV, YLT, Darby) that the app downloads automatically via the Library page. Do not download those by hand.

### Build from source

To develop Pellikan, run it in a browser, use an Intel Mac, or run on Linux and Windows, build from source.

#### 1. Requirements

| Tool                                 | Why                                                                                                     | Check                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Node 22.18 or newer**              | The UI and the data scripts. The scripts use Node's built-in `node:sqlite` and run TypeScript directly. | `node -v`                |
| **Git**                              | Cloning the repository                                                                                  | `git --version`          |
| **Rust** (stable)                    | Only for running or building the desktop window                                                         | `rustc -V`               |
| **Xcode Command Line Tools** (macOS) | Linker and the system web view (only for desktop / Rust)                                                | `xcode-select --install` |
| **Disk space**                       | ~700 MB for browser mode; ~4 GB total if compiling the desktop app (Rust build cache)                   |                          |
| **Network, once**                    | The initial data build downloads the source texts (~100 MB)                                             |                          |

Install Rust with `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`. If you just installed it, ensure Cargo is in your `PATH` by running `source "$HOME/.cargo/env"` or restarting your terminal.

If you only want to use or develop Pellikan in a browser (`npm run dev`), you do **not** need Rust or Xcode Command Line Tools.

macOS is the primary platform it has been built and tested on. Linux and Windows should work with Tauri's usual prerequisites
([Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)) but have not been tried.

#### 2. Get the code and build the data

```bash
git clone https://github.com/philorien/pellikan.git
cd pellikan
npm install
npm run data
```

`npm run data` downloads the public-domain and openly licensed source texts into `data/sources/` (~100 MB), builds `data/build/bible.db` (~270 MB, bundling WEB, BSB and KJV), and runs 76 integrity checks. It prints a line per source so you can see what went in. If it finishes with `All checks passed`, the database is ready.

`bible.db` must exist before running either the browser dev server or the desktop window. If you supply your own licensed ESV EPUB, place it in `data/sources/` before running `npm run data` (see [DATA_SOURCES.md](DATA_SOURCES.md)).

#### 3. Run it

##### Option A: In a browser (no Rust needed)

This is the quickest way to get started. The browser dev server serves all database queries locally via internal API routes.

```bash
npm run dev          # http://localhost:3000
```

##### Option B: As a desktop app (Tauri)

Requires Rust and Xcode Command Line Tools on macOS:

```bash
npm run tauri:dev
```

**macOS note.** If the Rust build fails at link time with `tapi error: malformed file ... libSystem.B.tbd`, your
Command Line Tools ship a newer SDK than your Rust toolchain understands (such as `MacOSX27.0.sdk`). Point the build at an older installed SDK:

```bash
ls /Library/Developer/CommandLineTools/SDKs/
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk npm run tauri:dev
```

If `cargo` is reported as not found, make sure `$HOME/.cargo/bin` is in your `PATH`.

#### 4. Build an installer (optional)

```bash
npm run data:build:release     # rebuilds bible.db WITHOUT the ESV
npm run tauri:build
```

If your macOS environment requires the SDK workaround above:

```bash
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk npm run tauri:build
```

Use `data:build:release`, not `data:build`, for anything you will share. The installer bundles `data/build/bible.db`,
and a plain build includes the ESV if your epub is present, which you may not redistribute.

The installer is placed in `src-tauri/target/release/bundle/dmg/` (or `.app` in `bundle/macos/`). The result is **unsigned**. Running it on your own Mac is fine (if Gatekeeper blocks it, right-click the app and choose **Open**). To give it to other people you need an Apple Developer ID to sign and notarize it, or macOS will warn them away.

### Getting the other translations

Open **Library**, find **Bible translations**, and press **Download** next to ASV, YLT or Darby. The app fetches the
list from this repository's `packs` release, downloads the pack, verifies its SHA-256 checksum, and installs it:

- In the desktop app, packs are saved to your app data folder (`~/Library/Application Support/com.lorienweb.pellikan/packs/` on macOS).
- In the browser dev server (`npm run dev`), packs are saved to `data/build/installed/`.

**Remove** deletes that file. If you are offline, the page says so and everything you already have keeps working.

To build the translation packs locally yourself instead of downloading from GitHub:

```bash
npm run data:fetch -- --packs
npm run data:packs
```

To point the app at your own host instead, set `PELLIKAN_PACKS_URL` to a manifest URL (https only; plain `http` works
for localhost). Details are in [DATA_SOURCES.md](DATA_SOURCES.md#optional-translations-downloaded-on-demand).

## Commands

| Command                                                   | What it does                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run data`                                            | Fetch sources, build `bible.db`, run the checks                                                                                                             |
| `npm run data:fetch` / `data:build` / `data:check`        | The three steps separately                                                                                                                                  |
| `npm run data:build:release`                              | Build without the ESV, for installers                                                                                                                       |
| `npm run data:fetch -- --packs` then `npm run data:packs` | Build the downloadable translation packs into `data/build/packs/`                                                                                           |
| `npm run dev`                                             | Browser dev server with a dev-only query API (http://localhost:3000)                                                                                        |
| `npm run tauri:dev` / `tauri:build`                       | Desktop app / installer                                                                                                                                     |
| `npm test`                                                | Node unit tests                                                                                                                                             |
| `cd src-tauri && cargo test --lib`                        | Rust tests. Those that need data run against `data/build/bible.db` and silently pass if it is missing, so build it first (use `SDKROOT` if needed on macOS) |
| `npm run build`                                           | Static site build                                                                                                                                           |

## How it is built

- **Tauri 2** (Rust and the system web view) for the desktop shell.
- **Nuxt 4** as a single-page app (`ssr: false`), **Tailwind v4**, **lucide** icons.
- **SQLite with FTS5** for all data, compiled into the app (`rusqlite` bundled build).
- **Separate databases, by purpose.** `bible.db` is read-only and ships with the app. `user.db` is for your data.
  Downloaded translations are one read-only file each. Updating reference data can never touch yours.
- **The UI never sends SQL.** It names a query; Rust (or the dev server) runs the matching file from
  `data/queries/`. One copy of every query serves both.
- **Canonical verse numbering** is English (KJV) with the 66 OSIS book ids. Hebrew numbering is mapped to it, and every
  bundled translation is checked against it at build time.

```
app/                   Nuxt UI: pages, components, composables
shared/                Code shared by the data scripts and the UI: books, references, morphology, text
data/queries/*.sql     Every query the app runs (data/queries/user/ holds the ones for your own data)
data/schema/           bible.sql (reference DB) and user.sql (user DB, idempotent)
data/scripts/          fetch, build, build-packs, check, translations catalog, and loaders/ for each source
server/                Dev-only API: queries and translation packs, for the browser dev server
src-tauri/             Rust shell: opens the databases, runs queries, installs translation packs
```

Notes, highlights, open tabs and preferences live in `user.db`, a SQLite file in the app's data directory (all behind
`app/composables/useUserData.ts` and `useTabs.ts`). Earlier builds kept them in the web view's `localStorage`; the
first launch after updating copies them into `user.db` once and leaves the old copy in place. Only the light or dark
theme choice still lives in `localStorage`. In the browser dev server, user data goes to `data/build/user.db` instead.
That file is shared by every origin the dev server runs on, so only the first one to load it has its `localStorage`
copied in: if Nuxt falls back from port 3000 to 3001, the second origin's old data is not migrated.

## What has been tested

Checked, with the commands that check it:

- **Data build** from the real upstream files. `npm run data:check` runs 76 checks: database integrity,
  verse counts, Hebrew and English chapters ending on the same verse, search ranking, every query preparing, and
  spot checks on the lexicons, commentary and cross-references.
- **78 Node unit tests** (`npm test`) covering the parsers and loaders, the Scripture reference scanner (not yet used
  by any screen; it is groundwork for importing your own books), the dev server's query runners, and the
  conversions that move older `localStorage` data into `user.db`.
- **19 Rust tests** (`cargo test --lib`, with `bible.db` built), including notes, highlights and settings round trips on `user.db`, a failed
  batch leaving nothing behind, the `user_query` and `user_batch` commands called through Tauri's mock IPC runtime
  (with remote origins refused), and translation-pack installs: wrong checksum, unsafe ids, a pack
  holding another translation's verses, and URL rules. The Rust crate compiles on macOS.
- **In a real browser** (the dev server): reading, switching between BSB, KJV, WEB and a downloaded translation,
  Word Study lexicon entries, Matthew Henry, cross-references, the dictionary, and installing and removing a
  translation pack from the real `packs` release. Also notes, highlights, text size and tabs saving to `user.db` and
  surviving a reload, older `localStorage` data being copied across on first run, and a failed save showing an error
  and keeping the unsaved note text.

**Not verified:** saving notes and highlights inside the desktop window. The `user_query` and `user_batch` commands are
tested through Tauri's mock IPC runtime, but not in a running app with the real web view and capability files. Windows and Linux, narrow phone-width layouts, and accessibility with a screen reader. The packaged macOS desktop app is in early preview (v0.0.1) and has had little real-world testing. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for the gaps found so far.

## Known limitations

Measured details are in [DATA_SOURCES.md](DATA_SOURCES.md). The ones that matter most:

- **English words are not clickable for Strong's numbers.** The tags in the WEB are unreliable for the Old Testament
  (measured), so word study goes through the Hebrew and Greek words.
- **Thayer's is OCR-derived** and the Treasury's references are parsed from its shorthand. Both can contain errors.
- **The WEB numbers the end of Romans differently** from the KJV (the doxology sits at Romans 14:24-26).
- **`bible.db` is large**, about 280 MB without the ESV. It compresses in an installer.
- **The Tauri content security policy is `null`.** Tighten it before adding any feature that handles API keys.
- Hebrew, Greek and English verse numbers are mapped, with a handful of documented exceptions.

## Roadmap

The live roadmap, with status for each item, is the [Pellikan GitHub Project](https://github.com/users/philorien/projects/2). The list below is the long-range order.

1. Refine the packaged desktop app on macOS, then add CI that runs the Node and Rust tests.
2. Move notes, highlights and bookmarks into `user.db`. Notes, highlights, tabs and preferences are done; bookmarks
   have a table but no UI yet.
3. Import EPUB, PDF, DOCX and plain text into `user.db`, with Scripture references found and linked.
4. AI-assisted search and questions with a bring-your-own key (Anthropic or Gemini), keys in the OS keychain and never
   in a database. Every answer carries a plain notice: AI can summarize and cross-reference text, but it cannot
   discern what the Spirit is saying. It is a concordance with a mouth, not a teacher.
5. Fix the accessibility gaps listed in [ACCESSIBILITY.md](ACCESSIBILITY.md).
6. Signed and notarized macOS builds, then Windows and Linux.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). It covers the workflow, the rules that protect the licensing of the data,
and how to add a translation or a data source. All contributions must follow the [Code of Conduct](CODE_OF_CONDUCT.md)
and the [AI Policy](AI_POLICY.md). [AGENTS.md](AGENTS.md) holds the same conventions in the short form for AI coding
agents. Accessibility problems are bugs: see [ACCESSIBILITY.md](ACCESSIBILITY.md).

## License

The code is licensed under the **GNU Affero General Public License v3.0** (see [LICENSE](LICENSE)). The data is licensed separately: see
[DATA_SOURCES.md](DATA_SOURCES.md). The built database contains CC BY-SA material (MorphGNT and Strong's Greek), so
distributing it carries ShareAlike obligations. Every source's license and required credit line also appear in the
app on the **Credits** page.
