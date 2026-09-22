# Design System — light / dark detail tables

Companion to `docs/design-system.md`, which carries the rules; this file carries the
per-shade and per-pattern detail for the **two colour families**. Split out so the main
doc stays skimmable. Everything here is derived from `web/src/index.css` as it ships —
line anchors are that file unless stated otherwise. The rendered version is
`/dev/design-system` (DEMO_MODE only); its "Side by side" toggle shows every swatch below
in both families at once.

**The one-paragraph version.** Six of the fifteen schemes are light (`default-light`,
`quest-log`, `sky`, `dawn`, `holy`, `celestial`). Tokens (`--color-*`) flip for free —
including the accent tokens `--color-success` / `-warning` / `-danger` / `-busy` / `-slot`.
Raw Tailwind accents do not — `index.css` repaints them for the light family: text bumps
from a `-400` to a `-600`/`-700`, tinted fills collapse to a `-100` wash, borders to a
`-300`. Two shades were never given an override and are unreadable on light (see the
table). Solid accent fills are identical in both families.

---

## 1. Accent shade pairs

**Accent tokens first.** These are not rewritten per class — the variable itself flips, so
every utility and every opacity modifier follows. Declared in `@theme` (`:50-62`) and the
shared light block (`:114-123`) only; contrast on `#ffffff` is recomputed by
`web/src/styles/semantic-tokens.guard.test.ts`.

| You write | Dark paints | Light paints | Anchor |
|---|---|---|---|
| `bg-success` / `text-success` / `bg-success/10` … | `#10b981` emerald-500 | `#047857` emerald-700, 5.48:1 | `:58` / `:118` |
| `bg-warning` / `text-warning` / `bg-warning/70` … | `#f59e0b` amber-500 | `#b45309` amber-700, 5.02:1 | `:60` / `:120` |
| `bg-danger` / `text-danger` / `bg-danger/50` … | `#ef4444` red-500 | `#dc2626` red-600, 4.83:1 | `:62` / `:122` |
| `bg-busy` / `text-busy` | `#8b5cf6` violet-500 | `#7c3aed` violet-600 | `:50` / `:114` |
| `border-slot` / `outline-slot` | `#22d3ee` cyan-400 | `#0e7490` cyan-700 | `:52` / `:115` |

`bg-X/N` on a token compiles to `color-mix(in oklab, var(--color-X) N%, transparent)`, so
it is correct at any alpha in both families.

**Raw hues.** You write ONE class. `:681-693` (text; `/60-/80` alphas `:696-702`, hovers
`:705-710`), `:713-735` (fills; hovers `:737-745`), `:747-759` (borders) rewrite it under
`:is([data-scheme="light"], [data-scheme="quest-log"], [data-scheme="sky"],
[data-scheme="dawn"], [data-scheme="holy"], [data-scheme="celestial"])`. Contrast figures
are the ones `index.css` records beside each rule.

| You write | Dark paints | Light paints | Anchor |
|---|---|---|---|
| `text-emerald-400` / `-300` | `#34d399` / `#6ee7b7` | `#059669` emerald-600, 3.77:1 — sub-AA → use `text-success` | `:687-688` |
| `text-emerald-500` | `#10b981` | `#047857` emerald-700, 5.48:1 | `:689` |
| `text-red-400` | `#f87171` | `#dc2626` red-600, 4.6:1 | `:681` |
| `text-amber-400` | `#fbbf24` | `#d97706` amber-600, 3.19:1 — sub-AA → use `text-warning` | `:682` |
| `text-yellow-400` / `-500` | `#facc15` / `#eab308` | `#ca8a04` / `#a16207` | `:683-684` |
| `text-green-400` / `-500` | `#4ade80` / `#22c55e` | `#16a34a` / `#15803d` | `:685-686` |
| `text-purple-400` | `#c084fc` | `#7c3aed` violet-600, 5.2:1 | `:690` |
| `text-indigo-400` | `#818cf8` | `#4f46e5` indigo-600, 5.9:1 | `:691` |
| `text-cyan-300` / `-400` | `#67e8f9` / `#22d3ee` | `#0891b2` cyan-600, 4.5:1 | `:692-693` |
| `text-amber-300` | `#fcd34d` | **`#fcd34d` — no override, ≈1.4:1 on white** → use `text-warning` | design-system.md §6.9 |
| `text-blue-400` / `-300` | `#60a5fa` / `#93c5fd` | **unchanged, ≈2.5:1 on white** | design-system.md §6.9 |
| `bg-<hue>-500/10` tint | the raw 10% hue | `<hue>-100` at 0.4–0.5 alpha | `:713-735` |
| `bg-amber-500/70`, `bg-red-500/50` (any unlisted alpha) | the raw hue | **no override** → use `bg-warning/70` / `bg-danger/50` | — |
| `border-<hue>-500/30` | the raw 30% hue | `<hue>-300` at 0.5–0.7 alpha | `:747-759` |
| `bg-emerald-600` (button fill) | `#059669` | `#059669` — same fill both families | design-system.md §6.10 |

Only the hues listed at `:713-735` get the tint treatment — `red`, `amber`, `emerald`,
`green`, `yellow`, `indigo`, `cyan`. A `bg-blue-500/10` or `bg-purple-500/10` surface has
**no** light-family mapping.

**Text on an accent fill.** Solid accent buttons keep their fill in both families, so the
label would go near-black on light (`--color-foreground` is `#0f172a` there). `:780-787`
forces `--color-foreground: #ffffff` for `.text-foreground` on `.bg-blue-600`,
`.bg-indigo-600`, `.bg-emerald-600`, `.bg-purple-600`, `.bg-red-600`, `.bg-red-500`,
`.bg-amber-600`, `.bg-violet-600` and Discord's `#5865F2`. Use `text-foreground` on a
solid accent button — not `text-white`, which opts out of that rule's bookkeeping.
**Exception — a token fill takes `text-white`:** `bg-success` (and any other token fill) is
not in that list, so `text-foreground` on it goes `#0f172a` on light. Write `text-white`
(`JourneyHero.tsx:163`), and keep solid *button* fills on the raw `bg-emerald-600` so the
forced-white rule still applies (`JourneyHero.tsx:173-175`).

**Badges over imagery are the exception.** A badge on cover art sits on the artwork, not
on the theme surface, so the light family's contrast bumps are wrong there. Put
`.badge-overlay` on the badge or its container and `:767-779` restores the DARK shades
under every light scheme. Consumers: `event-card.tsx`, `mobile-event-card.tsx`; guarded
by `web/src/styles/badge-overlay.test.ts`.

---

## 2. Elevation

- **Dark:** separation is the border (`border-edge`) plus the surface step `backdrop` →
  `surface` → `panel`. `.glass-card` is translucent with `blur(12px)` (`:651-655`). No
  shadow — a shadow on `#020617` is invisible.
- **Light:** the surface steps are ~4% apart (`#ffffff` → `#f1f5f9`), so the light family
  adds the shadow the dark family does not need: `.bg-panel` / `.bg-panel/50` /
  `.bg-panel/80` get `0 1px 2px rgba(0,0,0,.06)` (`:789-793`), and `.glass-card` becomes
  near-opaque — `color-mix(in srgb, var(--color-surface) 90%, transparent)` plus
  `0 1px 3px rgba(0,0,0,.08)`, rising to 95% / `.1` on hover (`:663-671`).
- You get this by using `bg-panel` / `.glass-card`. A hand-rolled `shadow-lg` (20 uses in
  `components/`) does not adapt and reads as a smudge on light.

---

## 3. Per-pattern detail

Every block below splits a pattern into what flips and what does not. The rule of thumb:
anything spelled as a token — the surface roles AND the accent tokens `success` /
`warning` / `danger` / `busy` / `slot` (§1) — flips with the family at any alpha; anything
spelled as a raw hue flips only if `index.css` hand-lists that exact class and alpha; and
two things never flip by design — a solid accent button fill (`bg-emerald-600`, label
forced white) and a data-driven inline alpha (`computeHeatmapBg`'s rgba).

### Filtering (§4.1)

Panel surface and mobile sheet are tokens, so they follow the family; the light family
adds the panel shadow above. The count badge does not move: `bg-emerald-500` +
`text-white` (`filter-panel.tsx::FilterBadge`) is identical in both, which is intended —
it is a solid accent, not a surface.

### Cards (§4.2)

Frame is tokens (`bg-surface` / `border-edge` / hover `bg-overlay`) and flips. The artwork
does not: `GradientOverlay`'s `from-black/80 to-transparent`
(`components/games/game-card-parts.tsx:66`) stays dark in both families because it exists
to make white title text legible over the *image*, not over the theme surface. Anything
layered on top of the art needs `.badge-overlay` (§1). `CoverPlaceholder` draws in
`text-dim` — `#64748b`, the one token whose value is identical in both families — so an
image-less tile reads the same either way.

### Chips (§4.3)

OFF is tokens and flips cleanly (`bg-panel` `#1e293b` → `#f1f5f9`, `text-secondary`
`#cbd5e1` → `#334155`). ON is three raw amber classes and only two are remapped: the fill
`bg-amber-500/10` → amber-100 at .5 (`:718`) and the border `border-amber-500/30` →
amber-300 at .5 (`:752`). `text-amber-300` has **no** light override — only its `hover:`
variant does (`:706`) — so the ON label stays `#fcd34d` on a near-white wash, ≈1.4:1. A
chip's ON state is unreadable in all six light themes (design-system.md §6.9). Until it
is fixed, a new ON-state label should use `text-amber-400`.

### Modal / bottom sheet (§4.4)

The dialog body is tokens; the scrim is a raw black alpha with no light-family override —
`bg-black/60 backdrop-blur-sm` (`components/ui/modal.tsx:68`) and `bg-black/50`, no blur
(`components/ui/bottom-sheet.tsx:105`). Identical dimming in both families, and heavier
feeling on light where it dims a white page. Do not add a third alpha; the two that exist
already disagree (design-system.md §6.11).

### Banners (§4.7)

Use the `-500/10` + `-500/30` pair and the light family rewrites both: an emerald banner
is a 10% emerald wash on dark and an emerald-100 wash on light. Body copy should be
`text-foreground` / `text-secondary` with only the icon or heading in the accent hue —
`text-blue-400` body copy is ≈2.5:1 on white.

### Forms, sliders, checkboxes (§4.11)

- **Focus ring.** `focus:ring-2` (56 uses in `components/`) plus an emerald ring, unchanged
  in both families. Measured: the SOLID `focus:ring-emerald-500` is the convention at 49
  uses; `focus:ring-emerald-500/50` is a 7-use minority. Match the file you are in; both
  read on `#0f172a` and on `#ffffff`, and `/50` is the softer of the two on light.
- **Disabled.** `disabled:opacity-50` (71) + `disabled:cursor-not-allowed` (59) is the
  pair, and opacity is family-agnostic. `disabled:bg-emerald-800` (12 uses) is not: it is
  a dark green with no light override, so a disabled primary button is a heavy dark block
  on a white page. Prefer `disabled:opacity-50` on the normal fill.
- **Native controls.** `accent-emerald-500` sliders/checkboxes and UA widget chrome follow
  `color-scheme`, which is set on `<html>` only (`:617-631`) — the one thing the scoped
  side-by-side preview cannot show you. Check those at the root.

### Count badges (§4.12)

A solid-fill badge (`bg-emerald-500` + `text-white`) is deliberately identical in both
families. An inline **tinted** count pill is not: use the `bg-<hue>-500/10` +
`text-<hue>-400` pair so it picks up the light remap, and add `.badge-overlay` when the
pill sits on cover art.

---

## 4. What does NOT cascade below the root

The light schemes declare their tokens on unqualified `[data-scheme=...]` selectors, so
they apply to a nested `<div data-scheme="sky">` as well as to `<html>`. The dark values
do not: they live on `@theme` (`:32`) and `html` (`:96`) with no `[data-scheme="dark"]`
block, so a scoped dark wrapper inherits whatever the root is (design-system.md §6.8 —
this is why `/dev/design-system` pins the root to `default-dark` while its side-by-side
view is on rather than scoping the dark column). The accent tokens (`success` / `warning` /
`danger` / `busy` / `slot`) live in the same two blocks, so they share that asymmetry: a
scoped light wrapper repaints them, a scoped dark one does not.

Root-only regardless of family — verify these at the root, never in a scoped preview:

| What | Where | Consequence |
|---|---|---|
| `color-scheme: dark/light` | `:617-631` | Native form controls, scrollbars, UA widgets |
| Page background | `body` `:633`, `#root` `:640` | A scoped column must paint its own `bg-backdrop` |
| quest-log parchment | `[data-variant="quest-log"] body::before` `:1269`, `body::after` `:1282` | Scoped quest-log gets panels but no page texture |
| Ambient particles | `components/ui/ThemeParticles.tsx` | Mounted once at app level (§2.7) |

---

## 5. Measured type scale

Frequency in `web/src/components`, with the page-level scale beside it (design-system.md
§2.4 carries the rule).

| Class | In components | Used for |
|---|---|---|
| `text-sm` | 636 | **Default.** Body, labels, buttons, list rows |
| `text-xs` | 408 | Hints, metadata, badges, captions |
| `text-lg` | 54 | Section / modal headings |
| `text-base` | 22 | Mobile form inputs only (prevents iOS Safari zoom on focus) |
| `text-xl` | 21 | Sub-page and card-group titles (43 uses in `pages/`) |
| `text-2xl` | 17 | Hero numbers (11 in `pages/`) |
| `text-3xl` | 0 | **Page `<h1>` only** — 14 uses, all in `web/src/pages/` |
