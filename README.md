# Cost Management — Design System

A design system distilled from **Cost Management** (家計簿) — a personal, mobile-first household-expense tracker. You log what you spent, where, and on what; the app charts it back to you. It is a single-user budgeting tool built around fast same-day entry and at-a-glance review, with currency in Japanese Yen (¥) and a Japanese household-ledger framing.

This is a **single-product** system: one app, one surface (mobile web), one identity. There is no marketing site, no second product.

## What the product is

- **Add** expenses fast: a big tap-to-enter amount, a numeric keypad, a category, then a shop. Three entry modes — Quick (one entry), Same shop (many days), Different (many shops).
- **Review**: an Overview of KPIs + spending trend (area & bar) + a category donut + top shops; a dot **Calendar**; a paginated **History** table; **Recurring** templates that resurface when due.
- **Organize**: user-defined categories, shops (favorited, grouped under a category), and tags — each with an emoji icon and a color.
- **Themes**: seven swappable dark gradient themes chosen from the header.

## Sources

- **Codebase (attached, read-only):** `Cost_management/` — a single-file React app (`index.html`, ~2700 lines) using React 18 + Babel standalone, Supabase (`cost_management_*` tables), and dependency-free SVG charts. `Cost_management/React/dashboard.jsx` and `Cost_management/Temp/index_R0xx_*.html` are earlier iterations; `Cost_management/sql/` holds the schema. The canonical UI is the root `index.html` (revision R018).
- No Figma file, brand book, logo files, or image assets were provided — the product ships none (see Iconography). This system reconstructs the foundations directly from the code.

---

## CONTENT FUNDAMENTALS

How the product writes.

- **Voice — plain, terse, second-person.** UI copy talks to the user directly and briefly: "Leave blank to be asked each time it's due.", "Tap ¥ for the keypad · pick a category", "Pick a category first." Imperatives dominate ("Add", "Save", "Skip", "Select…").
- **Sentence case everywhere** except small UPPERCASE field labels (`AMOUNT`, `CATEGORY`, `SHOW AFTER`) which are tracked out ~0.5px. Buttons are sentence case ("Add anyway", "Use these days").
- **Middots structure meta.** A center dot ` · ` joins related facts on one line: "2 days · 3 entries", "Supermarket · Today", "Daily · day 27". This is the signature connector — prefer it over commas or slashes in chrome.
- **Numbers are first-class.** Amounts always carry the ¥ glyph and thousands separators (`¥1,200`, `¥41,400`); compact axis labels use ¥k (`¥58k`). An em dash (—) or `¥–` stands in for "no value".
- **Status is spoken with an emoji prefix**, not a word: "✅ Added", "❌ Network error", "↺ Filters reset", "⚠ possible duplicate — ¥800 at Lawson already logged".
- **Tone is helpful, never chatty.** Hints sit under inputs in dim text; warnings are factual ("already logged on 2026-06-21"). No marketing voice, no exclamation beyond the success check. No "we" — the app is a quiet tool, not a brand persona.
- **Japanese accents.** A single kicker — 家計簿 ("household account book") — sits above the English wordmark. Otherwise the UI is English; Japanese appears in real shop/category names users type.
- **Emoji are functional, not decorative.** They are the icon system (see Iconography), so copy leans on them as nouns: a category IS its emoji + name.

---

## VISUAL FOUNDATIONS

The product's look in one line: **translucent glass panels floating on a soft dark gradient, hairline-ringed, with one bright brand color per theme and emoji standing in for icons.**

### Color
- **Dark, gradient-first.** The page is never flat — it's a 145° three-stop gradient (`--cm-bg`). Each of the 7 themes restates this gradient plus its own brand hue.
- **Translucent surfaces.** Cards/inputs are white (or theme-tinted) at **3–6% alpha** over the gradient, so the background glows through. There are no opaque panels except modals (`--cm-bg-solid`).
- **One brand color + an accent**, per theme (Midnight = `#2563eb` blue + `#7c3aed` violet). The brand color appears as: active pill fill (at 30% = `--cm-primary-glow`), CTA gradient (`primary→accent`), chart strokes, focus rings.
- **A four-step text ramp**: strong `#fff` (numbers, active) → body `#e0e0e0` → muted `#888` → dim `#666`. Emphasis is carried by brightness, not weight alone.
- **Status palette**: success `#10b981`, warning `#f59e0b`, danger `#ef4444`. Categories/tags each carry their own hex, washed to ~19% behind a 2px ring when selected.

### Type
- **One typeface: Noto Sans JP** (Latin + CJK), weights 300–700. See `tokens/typography.css`.
- **Dense, mobile scale.** Chrome runs 9–14px; the only large type is the **50px hero amount** (weight 700, −2px tracking) on the Add screen. Stat values are 16px/700; the page title 18px/700.
- **Uppercase tracked micro-labels** (9–11px, 0.5px tracking, muted) caption every field and chart panel. The 9px 家計簿 kicker uses 2px tracking.

### Space, radius, borders
- **Tight spacing** — the working range is 2–16px; 20–24px only between major blocks. Content is capped at a **460px mobile column**.
- **Rounded, but not pill-everything.** Chips 8px, inputs 10px, cards/keys 12px, panels 14px; nav & toggle **pills 16px**; bottom sheets 18px on the top corners only.
- **The signature "border" is a 1px INSET ring** (`box-shadow: inset 0 0 0 1px <border>`), not a solid stroke — it keeps the translucent edge crisp over the gradient. Selected chips use a real 2px colored `outline`.

### Elevation & blur
- **Mostly flat.** Cards and rows have no drop shadow — only the inset ring. Real shadows are reserved for lifted things: toast (`0 4 16 /.3`), drag (`0 8 24 /.45`), modal (`0 12 40 /.5`).
- **Backdrop blur (6px)** appears on the success-flash scrim and floating sheets, over a `rgba(0,0,0,0.8)` scrim.

### Motion
- **Quick, soft, no bounce.** Entrances are short fades + small upward translates (0.22–0.35s `ease`): `cmFadeIn`, `cmSlideIn` (−8px → 0), `cmSheetIn`, `cmToastIn` (slide from +24px x). The success flash fades a green check in over a blurred scrim.
- **Hover** brightens (`filter: brightness(1.18)`) and lifts 1px; **press** shrinks (`scale(0.94)`). Haptic `navigator.vibrate(10)` fires on most taps on mobile.
- No infinite/looping decorative animation. No parallax.

### Backgrounds & imagery
- **No photography, no illustration, no texture.** The "imagery" is the gradient itself plus emoji. Charts are dependency-free SVG with a subtle vertical fill gradient under the area line. There are no hand-drawn SVGs in the product — do not invent any.

### Hover / press / disabled recap
- Hover: brighten + 1px lift. Press: scale 0.94. Active pill/chip: brand glow fill or color wash + ring. Disabled: opacity 0.5, `cursor: not-allowed`, often the textDim background for CTAs.

---

## ICONOGRAPHY

**The icon system is emoji.** There is no icon font and no in-product SVG icon set. The only drawn mark is the **Orbit** app icon (`icons/icon.svg`, `icon-maskable.svg`, PNG sizes 192/512 + maskable, `apple-touch-icon.png`, `favicon-32.png`) — currency coins orbiting a location pin on a plum tile. Use it for launcher, favicon and login lockup only; never inside the UI.

- **Categories, tags, expense types, and nav are all emoji.** Categories: 🛒 Supermarket, 🏪 Convenience, 🌏 Asian shop, 🍜 Restaurant, 🧹 Daily needs, 📦 Other (plus a wide picker: ☕🚗🏠💊🎮📚👕💡✈️🎁💰🛍️…). Tags: 🍎 Food, 🍜 Dining Out, 🍇 Fruits, 🚃 Transport, ✈️ Travel. Expense types: 📌 Fixed, ⚡ Outlier (Normal has none). Nav: ➕ 📊 📅 📋 🔁 ⚙️. Favorites: ⭐/☆. Themes: 🌙 🌸 🌊 🌲 🌅 💜 ⚪.
- **Each category/tag pairs its emoji with a user-chosen color**; the emoji is shown in a small rounded tile washed with that color (`<color>22`) in lists, or bare in chips.
- **Unicode glyphs cover UI controls** where emoji would be too heavy: ◀ ▶ ▴ ▾ (nav/expand), ← → (pagination), × (close), ⌫ (keypad delete), ↻/↺ (repeat/reset), ＋/− (steppers), ● (calendar normal-day dot), ⚠ (inline warning), ✓ (success).
- **Status uses emoji prefixes** in toasts (✅ ❌ ↺ ⚠).
- **Guidance for new work:** reuse these exact glyphs. If you need an icon the product lacks, prefer a single representative emoji over importing an icon library — and never hand-draw an SVG icon, which would break the visual language.

---

## Index / manifest

Root files:
- **`styles.css`** — the single entry point consumers link. `@import`-only manifest.
- **`tokens/`** — `fonts.css` (Noto Sans JP), `colors.css` (palette + Midnight semantic defaults), `themes.css` (7 `[data-theme]` scopes), `typography.css`, `spacing.css` (space/radius/shadow/motion).
- **`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand) shown on the Design System tab.
- **`components/`** — reusable React primitives (see below), grouped by concern; each has `.jsx` + `.d.ts` + `.prompt.md`, with one `*.card.html` specimen per group.
- **`ui_kits/cost_management/`** — the interactive app recreation.
- **`SKILL.md`** — Agent-Skill manifest for using this system in Claude Code.

Components (namespace `window.CostManagementDesignSystem_49e6af`):
- **forms/** — `Button`, `IconButton`, `Input`, `Select`, `Chip`, `Keypad`
- **navigation/** — `NavTabs`, `Segmented`
- **layout/** — `Card`, `StatCard`, `Modal`
- **feedback/** — `Toast`, `Badge`
- **data/** — `AreaChart`, `BarChart`, `Donut`, `ProgressRow`

### Caveats
- **Fonts are loaded from Google Fonts**, not vendored — Noto Sans JP's CJK set is too large to bundle. For a fully offline build, download it and replace the `@import` in `tokens/fonts.css` with local `@font-face` rules.
- **Logo:** the Orbit icon set in `icons/` (SVG + PNG). The in-app identity is still the type lockup (家計簿 + wordmark); the icon appears on the launcher, favicon and login screen.
