# Accessibility

[![Accessibility target: WCAG 2.2 AA](https://img.shields.io/badge/a11y_target-WCAG_2.2_AA-informational)](#accessibility)
[![Open accessibility issues](https://img.shields.io/github/issues/philorien/pellikan/accessibility?label=open%20a11y%20issues&color=f143ab)](https://github.com/philorien/pellikan/labels/accessibility)

Pellikan is a reading and study tool, so it has to be usable by people who read in different ways: with a keyboard
instead of a mouse, with a screen reader, with low vision, with a lot of text zoom, or in a dim room.

**The target is WCAG 2.2 level AA. Pellikan does not meet it yet, and nobody has audited it.** This document records
what is in place, what was measured, and what is known to be wrong, so the gaps get fixed and nobody assumes more than
is true. It was written from reading the code and measuring the color palette. It was **not** written from testing with
assistive technology.

## How this was checked

- **Read the source** of the components and the stylesheet.
- **Computed contrast ratios** for every text color against the backgrounds it is used on, in both themes (WCAG relative
  luminance formula).
- **Not done:** VoiceOver, NVDA, JAWS or TalkBack testing; keyboard-only walkthrough of every screen; an automated audit
  (axe, Lighthouse); testing in the Tauri window (it has never been launched); testing at phone widths; Windows High
  Contrast or macOS "Increase contrast".

Treat everything under "In place" as "present in the code", not "confirmed to work for a user".

## In place

- **Keyboard.** `Cmd/Ctrl+K` opens the command palette. In it, Up and Down move, Enter selects, Escape closes. Menus
  (passage picker, settings) close on Escape. Verse numbers in the reader are real buttons, so a verse can be selected
  without a mouse. Footnote markers are focusable and respond to Enter and Space. `Cmd/Ctrl+Enter` saves a note.
- **Visible focus.** A global `:focus-visible` outline (2 px, accent color, 2 px offset) applies to everything.
- **Names for controls.** Icon-only buttons (close tab, new tab, delete note, previous and next chapter, theme toggle,
  text size, print) have `aria-label`s. Tab strips use `role="tablist"` / `role="tab"` with `aria-selected`.
  Collapsible panels set `aria-expanded`. Landmarks exist for the sidebar (`aside`), primary navigation, and `main`.
- **Dialogs.** The command palette and the phone study sheet use `role="dialog"` and `aria-modal`.
- **Color is not the only signal.** The current page is marked with `aria-current` and a bar, not just a color.
  Selected verses use a background, an accent-colored verse number, and `aria-pressed` on the verse-number button.
- **Text size and zoom.** Reader text size is adjustable (16 to 30 px). The viewport does not disable pinch zoom.
- **Reduced motion.** `prefers-reduced-motion: reduce` turns off all transitions and animations.
- **Themes.** Light, dark, and follow-the-system. The theme is applied before first paint so there is no flash.
- **Hebrew.** The original-language panel sets right-to-left direction for Hebrew and Aramaic words, and the lexicon
  headwords carry `lang` and `dir`.
- **Route changes.** `<NuxtRouteAnnouncer />` in `app/app.vue` announces the document title when the SPA route changes, so screen readers hear chapter and page moves. Invalid passages use the title `Passage not found · Pellikan` instead of the bare site name.
- **Document language.** The root `<html>` element sets `lang="en"` (WCAG 3.1.1 Level A) so screen readers pick an
  English voice for the UI. Downloadable Bible packs that are not English should set `lang` on their verse containers
  when that language is known.
- **Print.** Chrome is hidden and the chapter flows across pages.
- **Importing books (Library page).** The file input is a real, visually hidden `<input type="file">` with a label that shows a
  focus outline when it is focused. Progress and results are in an `aria-live="polite"` region, errors use
  `role="alert"`, the progress bar has an accessible name, and removing a book asks for confirmation in text (no browser
  dialog). Present in the code, not tested with a screen reader or on a phone-width screen.
- **Offline and failure states are text.** Failed loads and an unreachable translation catalog show a plain message
  instead of an empty area.

## Measured contrast

Ratios against the surface the text sits on. WCAG AA needs **4.5:1** for normal text and **3:1** for large text (about
24 px, or 19 px bold) and for interface components.

| Color | Used for | Light | Dark | Verdict |
| --- | --- | --- | --- | --- |
| `fg` | Body text | 15.4 | 14.0 | Pass |
| `muted` | Secondary text | 5.6 | 7.4 | Pass |
| `accent` | Links, active items | 6.2 | 7.9 | Pass |
| `jesus` (red letters) | Words of Jesus | 7.2 | 8.6 | Pass; 5.3 to 5.8 on highlights in light, 4.9 on yellow or green in dark |
| `faint` | Verse numbers, labels, hints, placeholders | 4.5 to 5.1 | 5.1 to 6.0 | Pass (lowest value is on `surface-2`) |
| `brand` | Small uppercase section labels, footnote markers | 5.0 to 5.7 | 6.3 to 7.6 | Pass |
| `accent-fg` on `accent` | Text on buttons | 6.5 | 8.6 | Pass |
| `fg` on highlight colors | Highlighted verses | 11.3 to 12.6 | 8.0 to 9.9 | Pass |

To recompute after changing the palette, use the relative-luminance formula in WCAG 2.2 or any contrast checker with
the hex values in `app/assets/css/main.css`.

## Known gaps

These were found by reading the code and measuring. Items struck through have been fixed in code but not re-tested with assistive technology. Roughly in order of impact.

1. ~~**`text-faint` fails contrast.**~~ Fixed: `faint` and the light `brand` were re-tuned to 4.5:1 or better. Original note:
   **`text-faint` fails contrast.** It is used for verse numbers, panel hints, placeholders and small metadata, in both themes (3.1:1 light, 3.9:1 dark). Darken it in light mode and lighten it in dark mode until it
   reaches 4.5:1, or stop using it for text that carries meaning. This affects the most-seen text in the reader (the
   verse numbers).
2. ~~**`text-brand` fails in light mode**~~ Fixed, see 1. Original note: **`text-brand` fails in light mode** (3.3:1) and is used for small bold uppercase labels such as "Footnote" and the
   the Commentary and Dictionary source labels. Use a darker variant for text.
3. ~~**No skip link.**~~ Fixed: a "Skip to main content" link is the first focusable element and moves focus to `<main id="main">`. Original note: **No skip link.** Keyboard users tab through the sidebar, top bar and tab strip on every page before reaching the
   content. Add a "Skip to main content" link as the first focusable element.
4. ~~**The command palette does not trap focus.**~~ Fixed: Tab and Shift+Tab wrap inside the dialog and focus returns to the opener on close. Original note: **The command palette does not trap focus.** It declares `aria-modal="true"` but Tab can move to the page behind it.
   Trap focus inside while open and return it to the control that opened it when it closes.
5. **Selecting a verse by clicking its text is pointer-only.** The verse number button is keyboard accessible, so the
   function is reachable, but the whole-verse click target is a plain `span`. Make sure focus order and the selected
   state are announced when a verse is chosen.
6. **The tab strip is not a full ARIA tabs widget.** It has the roles but not the Left and Right arrow-key behavior or
   roving `tabindex` the pattern expects. It is also hidden below the `md` breakpoint (phones use the bottom navigation).
7. ~~**Small targets.**~~ Tab close buttons and highlight swatches are now 24 px; the 44 px touch size is still not met. Original note: some controls were 20 px square (the close button on each tab, the highlight color swatches), under
   the 24 px minimum in WCAG 2.2 criterion 2.5.8 and well under the usual 44 px for touch.
8. **Few live regions.** Searches, chapter loads, installs and the Word Study results update the page without telling a
   screen reader. Only one place uses `role="status"`, and the book import progress uses `aria-live`. Add polite live regions for result counts and completion.
9. ~~**Language is not marked everywhere.**~~ Fixed: original-language words carry `lang="grc"` or `lang="he"`. Original note: The Greek and Hebrew words in the original-language panel do not carry `lang`
   attributes (the lexicon headwords do). Without them a screen reader may read Greek with an English voice.
10. ~~**The reader has no `h1`.**~~ Fixed with a screen-reader-only `h1` (book and chapter). Original note: Every other page has one, but in the normal reading view the heading is missing (the
    passage name is inside a picker button), and the study panels use their own headings. The outline has not been
    checked for skipped levels.
11. **Hover and color-only hints.** Some information (for example, which Hebrew psalm title is clickable, and the
    cross-reference preview text on hover) is available only on hover or by color. Check each against 1.4.1 and 1.4.13.
12. **The desktop shell is unverified.** The Tauri window uses the system web view (WKWebView on macOS), which has its
    own accessibility behavior. None of this has been checked there.

## Reading in the original languages

Hebrew and Aramaic read right to left and carry vowel points and cantillation marks; Greek carries accents and
breathings. Screen reader support for these is uneven across voices and platforms. Pellikan stores a normalized form for
searching (marks stripped) but displays the full text. If a voice reads the pointed text badly, that is a limitation of
the voice, and it is worth recording here when someone finds out which combinations work.

## How to test a change

Do these for any UI change, and say in the PR what you did and did not do.

1. **Keyboard only.** Unplug the mouse. Reach and operate every control you touched. Check the order is logical, the
   focus outline is visible on every state, Escape closes what opened, and focus returns somewhere sensible.
2. **Zoom.** Set the browser to 200% and 400% width-equivalent. Nothing should be cut off or need horizontal scrolling
   (apart from deliberately scrolling lists such as the interlinear row).
3. **Both themes.** Look at it in light and dark. Compute the contrast of any new text color; do not judge by eye.
4. **Screen reader.** On a Mac, turn on VoiceOver (`Cmd+F5`) and move through the page. Are the names, roles and states
   announced? Do loading and result changes get announced?
5. **Reduced motion.** Turn on "Reduce motion" in the system settings and confirm nothing animates.
6. **An automated pass.** Run an axe or Lighthouse accessibility audit on the page. It will not catch everything, but it
   catches the cheap mistakes.

Component rules:

- Every button has a text label or an `aria-label`. Icon-only buttons mark the icon `aria-hidden="true"`.
- Use real `button`, `a`, `label` and form elements before reaching for a `div` with a handler.
- Text colors must reach 4.5:1 on the surfaces they sit on in both themes, including `text-faint` and `text-brand`. Use `text-accent-fg` (not `text-white`) on `bg-accent`.
- Targets are at least 24 by 24 px, and 44 by 44 px for primary touch controls.
- State changes the user cannot see on their own (a download finished, search returned 25 results) go in a polite live
  region.
- Mark foreign-language text with `lang`, and set `dir` for right-to-left runs.

## Reporting a problem

Open an issue titled "Accessibility: " followed by what you were doing, what you expected, what happened, and your
platform and assistive technology (for example, "VoiceOver on macOS 26 with Safari"). Accessibility problems are bugs and
are fixed in the order of how much they block someone from reading.
