# COST · memory · soft keyboard stability while typing (build v57)

**Date:** 2026-10-12 to 2026-10-14
**Build:** v57 (`sw.js` → `cm-shell-v57`)
**Branch:** `claude/keyboard-dismissal-text-input-0mogmd`, commit `8da9c08`
**Live?** Not yet. GitHub Pages publishes `main` only. Merge the branch into `main`, wait about a minute, then close and reopen the installed app on the phone.

**Not verified on a phone.** The JSX compiles under Babel. The app could not be booted in a browser in the cloud session because jsDelivr was blocked there.

---

## What the user reported

On Android (Gboard / Google Japanese Input), typing a new shop name in the Shop sheet (Add → Convenience → ＋ New shop) was hard. Switching the keyboard language (あa / 日本語) made the keyboard drop mid-word, and the sheet jumped up and down around it.

## Root cause

- **The language switch itself** briefly hides the keyboard. Android does that, and a web page cannot stop it. The input kept its focus throughout.
- **The page made it much worse.** Bottom sheets are full-screen fixed layers. Chrome scrolled the whole page up under the keyboard and snapped it back when the keyboard hid, so every switch caused a jump.
- **Two app-side focus thieves.** The recurring-due and nearby-payments sheets open on a 15 s timer and had an `autoFocus` amount field. If one fired while typing, it took the focus and swapped the keyboard to numeric.
- **Overlay stacking was wrong.** Dialogs were z 100, under sheets (300) and under the bottom tab bar (200).

## What changed

| area | change |
|---|---|
| `index.html` viewport | added `interactive-widget=resizes-content` (keyboard shrinks the layout viewport on Chrome Android) and `viewport-fit=cover` (safe-area insets work on iOS) |
| header | top padding includes `env(safe-area-inset-top)` |
| new helpers in `app.jsx` | `isTextEntry`, `isTyping()`, `useKeyboardUp()` hook, `asciiDigits()` |
| location trigger tick | does not open the Nearby payments sheet while `isTyping()`; retries on the next tick |
| Recurring / Location due sheets | amount field uses `autoFocus={!isTyping()}` |
| `Modal` | z-index is `300 + depth*2`; each overlay stacks above the ones already open and above the tab bar |
| mobile tab bar + floating pills | hidden while a text field has focus (`useKeyboardUp`), back on blur after a 120 ms grace |
| New shop / New category name fields | `autoFocus` on open, `enterKeyHint="done"`, Enter submits, IME-composition Enter ignored |
| text amount fields (request inbox, Sukkiri confirm, Sent-to-WF log) | accept full-width digits `１２３` and `。`/`．` via `asciiDigits()` |
| `sw.js` | shell cache v56 → v57 |

## Rules to keep from now on

- **No `autoFocus` in anything that opens on its own** (timers, GPS, sync). Guard it with `!isTyping()`, or don't open the sheet while the user is typing.
- **Use the shared `Modal`** for every overlay so stacking stays correct. Don't hard-code z-index for overlays.
- **Anything `position: fixed` at the bottom** should hide while `useKeyboardUp()` is true.
- **Amount fields typed as text** should clean input with `asciiDigits()`, not `replace(/[^0-9.]/g, "")`.
- **Text fields that submit** should handle Enter but skip it when `e.nativeEvent.isComposing` is true (Japanese IME).
- **Bump `cm-shell-vNN` in `sw.js`** on every change, or installed phones keep the old build.

## Open items

- **▶ user:** test the New shop flow on the phone after merging. The keyboard will still blink on a language switch, but the sheet should stay still and the cursor should stay in the field.
- **iOS input zoom, not changed.** iOS Safari zooms into inputs under 16 px on focus, and most inputs here are 12–15 px. Fixing it needs either 16 px input text or `maximum-scale=1`, which also blocks pinch zoom on Android. Decide before changing.
