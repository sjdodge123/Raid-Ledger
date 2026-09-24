# Raid Ledger — Design System Reference

**Audience: agents about to add or change UI.** Everything below is derived from what ships in `web/src`
today — read the cited files, they are the source of truth and this doc is the index. Nothing here is
aspirational. Per-family shade and per-pattern detail lives in the companion
`docs/design-system-tokens.md`; the rendered version is `/dev/design-system`.

**Why this file exists (operator, 2026-09-13):** "A lot of new features end up doing something drastically
different and it leaves users confused." Canonical example: `/games` filters with the shared
`FilterPanel`; the lineup's Common Ground panel is a bespoke card with none of it — same job, two designs,
because nothing told the second author. **Resolved 2026-09-23 (ROK-1659):** Common Ground now uses the
same primitive — §4.1, §6 divergence #1.

## Keeping this doc current (STRICT)

This doc is only as good as its last update. Any PR that adds or changes a colour token, a
`web/src/components/ui` primitive, a shared component used on 2+ pages, or a layout/interaction pattern
MUST, in the SAME PR:

1. Update the relevant section and inventory row here (§2/§3/§4).
2. Update `docs/design-system-tokens.md` for token changes.
3. Add or update the example on `/dev/design-system` (`web/src/dev/design-system/`).
4. State it in the PR body — see CLAUDE.md "Reference designs before coding" rule 2.

Reviewers treat a missing update as a MINOR finding. See CLAUDE.md "Reference designs before coding" rule 4.

---

## 1. Before adding UI — checklist

1. **Find the primitive.** Search §3 below, then `web/src/components/ui/`, then the de-facto shared list.
   If something with that job exists, use it.
2. **Match the pattern.** §4 gives the DO for each recurring job. Copy the DO, not the nearest file you
   happened to open.
3. **Check for an approved design target** before you draw your own — §7 below indexes every settled
   design (artifact URL, local copy, the stories that implement it); see also `CLAUDE.md` → "Reference designs
   before coding". Existing: `docs/spikes/rok-1193-lineup-ux-audit.md`, and the DEMO_MODE routes
   `/dev/wireframes/simplify` (Cycle 4 "Unify"), `/dev/wireframes/lineup`,
   `/dev/wireframes/binding-admin`, `/dev/design-system` (this document, rendered — `web/src/dev/`).
4. **Use tokens, never raw slate.** `bg-panel`, not `bg-slate-800`. Fifteen themes remap the tokens; a
   hardcoded slate breaks in all of them.
5. **If no primitive fits, say so out loud.** Put a line in the PR description: `New pattern: <what> —
   <why nothing existing fits>`. Silent invention is the failure mode this doc exists to stop.
6. **Verify in `default-dark` AND `default-light`, plus `sky` (a per-scheme override), before calling UI
   done.** Six of fifteen themes are light; a dark-only check ships a contrast bug to all of them.
   `/dev/design-system` has a scheme switcher and a side-by-side toggle for exactly this.
7. **New surface tokens go into the shared light block AND the four per-scheme light blocks** —
   `index.css:106` (`:is(light, quest-log, sky, dawn, holy, celestial)`), then `:199` `sky`, `:251` `dawn`,
   `:303` `holy`, `:355` `celestial`: those four re-declare the surface/text/edge set, so a surface token
   added only to the shared block is unthemed in them. **Scheme-agnostic accents are the exception** —
   `--color-busy`, `--color-slot`, `--color-success`, `--color-warning`, `--color-danger` live in exactly
   two blocks, `@theme` and the shared light block, and inherit into the four per-scheme blocks (ROK-1586
   OQ-1). The dark defaults live on `@theme` (`:32`) and `html` (`:96`) — the root only, which is §6.8.

---

## 2. Tokens

### 2.1 Colour roles

Declared in `web/src/index.css` (`@theme` block, line 32) as `--color-*`. Tailwind v4 generates the
utility from the variable name: `--color-panel` → `bg-panel`, `text-panel`, `border-panel`. Borders have
their own roles.

**Contrast guards.** `web/src/styles/semantic-tokens.guard.test.ts` (on main) checks semantic token
contrast; `raw-hue-light.guard.test.ts` (landing with PR #1318 — not yet on main) checks raw Tailwind
hue contrast on the light families. Any colour token change MUST keep both green — a token edit that
turns one red is not done, not "acceptable regression."

| Token | Tailwind | Dark (default) | Light | Role |
|---|---|---|---|---|
| `--color-backdrop` | `bg-backdrop` | `#020617` | `#f8fafc` | Page background, behind everything |
| `--color-surface` | `bg-surface` | `#0f172a` | `#ffffff` | Cards, headers, sheets |
| `--color-panel` | `bg-panel` | `#1e293b` | `#f1f5f9` | Inset panels, inputs, chips (off) |
| `--color-overlay` | `bg-overlay` | `#334155` | `#e2e8f0` | Hover fill on panel-level surfaces |
| `--color-faint` | `text-faint` | `#475569` | `#cbd5e1` | Lowest-contrast text/lines |
| `--color-dim` | `text-dim` | `#64748b` | `#64748b` | Placeholders, disabled text |
| `--color-muted` | `text-muted` | `#94a3b8` | `#475569` | Secondary/label text (most common) |
| `--color-secondary` | `text-secondary` | `#cbd5e1` | `#334155` | Body text |
| `--color-foreground` | `text-foreground` | `#ffffff` | `#0f172a` | Primary text, headings |
| `--color-edge` | `border-edge` | `#334155` | `#cbd5e1` | Default border |
| `--color-edge-strong` | `border-edge-strong` | `#475569` | `#94a3b8` | Emphasised border |
| `--color-edge-subtle` | `border-edge-subtle` | `#1e293b` | `#e2e8f0` | Hairline divider |
| `--color-busy` | `bg-busy` `text-busy` `before:bg-busy` | `#8b5cf6` | `#7c3aed` | Someone is committed elsewhere in this hour (ROK-1584) |
| `--color-slot` | `border-slot` `outline-slot` | `#22d3ee` | `#0e7490` | A time someone already proposed in a poll (ROK-1587/1588) |
| `--color-success` | `bg-success` `text-success` `border-success` `ring-success` … | `#10b981` | `#047857` | Free / confirmed / "on" / primary state (ROK-1586) |
| `--color-warning` | `bg-warning` `text-warning` `border-warning` … | `#f59e0b` | `#92400e` | Partial agreement, needs attention, admin (ROK-1586) |
| `--color-danger` | `bg-danger` `text-danger` `border-danger` … | `#ef4444` | `#b91c1c` | Conflict, destructive, "few free" (ROK-1586) |

**The accent rows** (`@theme` `index.css:50-62`, shared light block `:114-125`) are declared in those two
blocks only — see checklist item 7. The dark values are the Tailwind shades they replaced
(emerald-500 / amber-500 / red-500). The light values are darker than the `-600` the old
`.text-*-400` overrides use, because `-600` fails WCAG AA for small text: on `#ffffff`
success `#047857` is 5.48:1, warning `#92400e` (amber-800) 7.09:1, danger `#b91c1c` (red-700) 6.47:1
(`web/src/styles/semantic-tokens.guard.test.ts` recomputes these and fails below 4.5:1 — for warning and
danger also on the panel, the JourneyHero card and their own `/10` tint over the panel — and pins the
two-block declaration of success/warning/danger/busy). The opacity modifier works at any alpha
(`bg-success/10`, `border-warning/30`, `bg-danger/50`) — Tailwind compiles it to
`color-mix(in oklab, var(--color-X) N%, transparent)`, so there is no per-alpha light rule to forget. A
hand-built value that must match a class (a gradient half, an inline style) uses the same spelling,
including `in oklab` — `components/features/game-time/phone/week-strip.fills.ts` is the reference.

**Themes.** Fifteen schemes (`web/src/stores/theme-registry.ts`). `data-scheme` on `<html>` swaps every
value — except `quest-log`, applied via `data-variant` (`theme-helpers.ts:53,76-82`; tokens at
`index.css:1198`). Light family: `default-light`, `quest-log`, `sky`, `dawn`, `holy`, `celestial` (shared
block `index.css:106`, plus per-scheme re-overrides `:199` `sky`, `:251` `dawn`, `:303` `holy`, `:355`
`celestial` — see checklist item 7). Dark family: `default-dark`, `space`, `underwater`, `obsidian`,
`ember`, `arctic`, `bloodmoon`, `forest`, `fel`. Every colour must be a token or a §2.2 accent hue — a raw
hex is a bug in 14 of the 15 themes.

**The two families are not symmetric:** light tokens sit on *unqualified* `[data-scheme=...]` selectors
and therefore cascade into nested scopes, while the dark tokens are declared on `@theme` (`:32`) and
`html` (`:96`) only — root-only, so a scoped dark wrapper inherits whatever the root is (§6.8). Root-only
either way: `color-scheme` (`:617-631`), page background (`:633`, `:640`), quest-log parchment (`:1269`,
`:1282`) — full list in `docs/design-system-tokens.md` §4.

### 2.2 Accent hues (raw Tailwind, deliberate)

**Success, warning and danger are tokens** (§2.1, ROK-1586). **Every other accent is still a raw Tailwind
hue** used by convention, with per-theme contrast fixes in `index.css` (light overrides from `:681`, plus
`.badge-overlay` for badges over imagery). As of ROK-1586 only the journey hero, the week strip and the
week-cell marks use the tokens (FeedbackDialog's inline `var(--color-danger, #ef4444)` fallback is gone —
its error is now a `role="alert"` `text-danger` line, ROK-1651); the rest of the app is unmigrated (see
`TECH-DEBT-BACKLOG.md`, 2026-09-22).

- **DO** use `bg-success` / `text-warning` / `border-danger` when the colour carries a *meaning*. A
  scheme repaints the token; it cannot repaint `bg-emerald-500`.
- **DO** use raw hues for *categorical* accents — a genre badge, a chart series, a wireframe
  BEFORE/AFTER — where the colour promises nothing.
- **DO** put the opacity modifier on the token (`bg-success/10`, `border-warning/30`): it works at any
  alpha. The raw hues only have light mappings for the alphas hand-listed in `index.css` —
  `bg-amber-500/70` had none; `bg-warning/70` needs none.
- **DON'T** tokenise a **solid accent button fill.** `bg-emerald-600` / `bg-red-600` stay raw because the
  forced-white label rule (`index.css:780-787`) is keyed to those class names; the journey hero's CTA keeps
  `bg-emerald-600` for exactly this reason (`JourneyHero.tsx:173-175`).
- **Text on a `bg-success` fill is `text-white`, not `text-foreground`.** `bg-success` is not in the
  forced-white list, so `text-foreground` would turn `#0f172a` on the six light schemes; `text-white` is
  what the dark family already paints, and the light fill (`#047857`) is darker than the dark one, so the
  label only gains contrast there (`JourneyHero.tsx:163`). This is the one
  exception to the `design-system-tokens.md` §1 "use `text-foreground` on a solid accent" rule.
- **Exempt:** `computeHeatmapBg` — an alpha that encodes data cannot be a class.

Measured `bg-*` use in `web/src/components` (`grep -rhoE "bg-<hue>-[0-9]+" web/src/components
--include='*.tsx'`, excluding tests):

| Hue | Count | Means |
|---|---|---|
| `emerald` | 280 | Primary action, success, "on"/active, brand |
| `red` | 104 | Danger, destructive, BEFORE/wrong in wireframes |
| `amber` | 92 | Warning, admin, and the **chip-on** state (`bg-amber-500/10 border-amber-500/30 text-amber-300`) |
| `blue` / `indigo` | 58 / 22 | Secondary CTA, informational |
| `cyan`, `purple`, `yellow`, `green` | ≤14 each | One-off categorical accents — do not add more |

Alpha-on-token is the house style for tinted surfaces: `bg-emerald-500/10` over `bg-panel`, border
`border-emerald-500/30`. Solid fills (`bg-emerald-600`) are for buttons only.

**Dark shade vs light shade.** You write ONE class and `index.css` repaints it for the six light schemes:
text `-300`/`-400` → a `-700`…`-800` shade (`:688-705`), tinted fills → a `-100` wash (`:723-758`), borders → a `-300`
(`:759-773`); solid fills are identical in both with the label forced white on light (`:796-803`), and
`.badge-overlay` (`:774-794`) opts cover-art badges out. Every text repaint — and its `/60`–`/80` opacity variants
and `hover:` rules — clears 4.5:1 on EVERY light scheme's own surface, panel and the hue's `-500/10` chip tint over
that panel. Celestial's `#e4ddd0` panel is the binding case, so red, emerald, purple and indigo repaint one step past
the token values (red-800 `#991b1b`, emerald-800 `#065f46`, violet-700 `#6d28d9`, indigo-700 `#4338ca`); the opacity
variants carry the AA alpha floor (red `.9`, amber `.95`). `web/src/styles/raw-hue-light.guard.test.ts` parses each
light scheme's surface/panel out of `index.css` and enforces it (ROK-1586). Still prefer
`text-success` / `text-warning` / `text-danger` for new semantic text.

> **Full shade-pair table:** `docs/design-system-tokens.md` §1 — or `/dev/design-system`
> → *Accent hues*, where every row paints in the class it documents and the "Side by
> side" toggle shows both families at once.

### 2.3 Game-time widget tokens

`--gt-widget-bg`, `--gt-widget-border`, `--gt-split-bg`, `--gt-past-highlight`, `--gt-hover-glow`,
`--gt-proximity-line`. Declared on `html` (`index.css:96`), re-declared per theme. They exist because the
game-time grid paints via **inline styles** computed per cell, where Tailwind classes cannot reach. Note
`--gt-proximity-line` is a bare RGB triple, used as `rgb(var(--gt-proximity-line) / <a>)`. Game-time grid
only.

### 2.4 Type scale

Fonts: `Inter` body (set on `body`, line 596), `.font-display` → `Cinzel` (`index.css:604`), plus
`MedievalSharp` / `Uncial Antiqua` inside the quest-log theme only. Loaded from Google Fonts at the top of
`index.css`.

`text-sm` is the **default** (body, labels, buttons, rows); `text-xs` for hints, metadata and badges;
`text-lg` for section/modal headings; `text-base` for mobile form inputs only (stops iOS Safari zoom);
`text-xl` for sub-page titles; `text-2xl` for hero numbers; `text-3xl` for the page `<h1>` and nothing
else. Measured counts: `docs/design-system-tokens.md` §5.

Weights: `font-medium` (364) for labels and chips, `font-semibold` (213) for headings, `font-bold` (48)
for page titles, badge counts and emphasis, `font-mono` (8) for numeric readouts next to a slider. There
is no `font-light`.

### 2.5 Spacing, radius, elevation

- **Gap ladder:** `gap-2` (251) is default, `gap-3` (145) for looser rows, `gap-1` / `gap-1.5` inside
  chips and badges, `gap-4` / `gap-6` between sections. Padding follows: `p-3`/`p-4` for cards, `px-3
  py-2` for inputs and buttons, `px-2 py-0.5` for pills.
- **Radius:** `rounded-lg` (394) is the default for cards, panels, inputs and buttons. `rounded-full`
  (192) for chips, pills, avatars and count badges. `rounded-xl` (61) for hero/large surfaces.
  `rounded-md` (57) for small inputs. Avoid `rounded-2xl` (1 use).
- **Elevation** is border + tint, not shadow. `.glass-card` (`index.css:610`) is the one blurred surface;
  `.glow-emerald` / `.glow-indigo` (`index.css:778,786`; vars at `:438-439`) glow a primary action. Themes
  restyle these — never reimplement them inline.
  - **Light / Dark:** dark separates with border + surface step; light adds the shadow it needs
    (`:753-757`, `:622-630`). `bg-panel` / `.glass-card` give you both; a hand-rolled `shadow-lg` adapts
    to neither. Detail: `design-system-tokens.md` §2.
- **Tap targets:** `min-h-[44px]` on anything touchable (WCAG 2.5.5 / Apple HIG). The form
  primitives build it in — `form-classes.ts` (fields stay 44px below `lg`), `slider.tsx` (an `h-11` hit
  area in a 44px row), `checkbox.tsx` (the whole label row is the target) — so a filter body such as
  `pages/games/coop-filter-controls.tsx` gets it by composing them rather than restating it.

### 2.6 Motion

- `transition-colors` (348) is the default and covers hover/active states. `transition-all` (45) only
  where size or position also moves, `transition-transform` (15), `transition-opacity` (11).
- Springs are named CSS variables: `--spring-smooth` / `--spring-bounce` — cubic-bezier on `:root`
  (`index.css:449-452`), upgraded to `linear()` easing inside `@supports` at `:456-469` (older browsers
  get the fallback). `@keyframes modal-spring` (473) and `drawer-slide` (486) are the entrance animations
  for `Modal` and `BottomSheet`.
- A global rule scales `button:active, a:active, [role="button"]:active` to `0.97` — you get press
  feedback for free; do not add your own.
- `@media (prefers-reduced-motion: reduce)` flattens every spring and animation. Any new animation must
  survive that block being applied.

### 2.7 Theme particles

`components/ui/ThemeParticles.tsx` + `theme-particles.{config,effects,helpers,tick}.ts` — canvas ambient
particles and per-theme background effects — the only three `bgEffect`s are `aurora` (arctic, `:27`),
`lava` (ember, `:33`) and `sun` (**dawn**, `:81`). Ten of the fifteen schemes have a `CONFIGS` entry;
`default-dark`, `default-light`, `quest-log`, `sky` and `obsidian` do not, and `forest` has an entry but
no `bgEffect`. `pointer-events: none`, respects reduced motion, height-capped to document content.
Mounted once at app level — never a second instance, and root-only: a scoped preview cannot show it.

---

## 3. Component inventory

### 3.1 `web/src/components/ui/` — the shared primitives

| Component | What it is | Use when | Key props |
|---|---|---|---|
| `filter-entry.tsx` → `FilterEntry`, `FilterEntryTrigger` | **The** filter entry point — the funnel standard (§4.1, ROK-1659). Pairs `FilterPanel` with the right opener for the viewport: `FilterEntryTrigger` renders the toolbar funnel at ≥1024px and nothing below it; `FilterEntry` renders the inline panel at ≥1024px and the `FilterFab` + `BottomSheet` below. Pages build on this, not `filter-panel.tsx` directly. | Any list/grid filtering, anywhere — `/games`, Common Ground, Calendar | `activeCount`, `isOpen`, `onOpenChange`, `onClearAll`, `children`, `stackAboveCreate`, `describeCount`; trigger: `activeCount`, `isOpen`, `onOpenChange`, `describeCount` |
| `filter-panel.tsx` → `FilterPanel`, `FilterPanelTrigger` | The lower-level pieces `filter-entry.tsx` composes: `FilterPanel` is the inline collapsible panel ("Filters" + "Clear all", scrolls internally past `max-h-[500px]`) that becomes a `BottomSheet` below `DESKTOP_MQ`, and closes on Escape with focus returned to the trigger (§4.1); `FilterPanelTrigger` is the bare 44px funnel button. Reach for these only when `FilterEntry` doesn't fit. | Building a new filter entry point, or reading how one works | `activeFilterCount`, `onClearAll`, `isOpen`, `onToggle`, `onClose`, `children`; trigger: `activeCount`, `isOpen`, `onClick`, `describeCount` |
| `filter-fab.tsx` → `FilterFab` (+ `fab-position.ts`) | The Filters FAB (§4.1, ROK-1659): 56px round, `right-4` (`md:right-5` from 768px, centred over the feedback button), `lg:hidden`, neutral tone (`bg-surface border-edge-strong`) with the active-filter badge. Portaled to `document.body` so a sticky toolbar's stacking context never traps it. Normally reached through `FilterEntry`, not mounted directly. | Phone/tablet filter entry, below 1024px | `activeCount`, `isOpen`, `onClick`, `stackAboveCreate` (lifts it above a page's create `FAB` — `fab-position.ts`), `describeCount` |
| `filter-count-badge.tsx` → `FilterCountBadge` | The active-filter count badge shared by `FilterPanelTrigger` and `FilterFab`: solid `bg-success` pill, renders nothing at 0, count re-exposed via `aria-describedby` since both openers are named "Filters". | Never mounted directly — internal to `filter-panel.tsx` / `filter-fab.tsx` | `count`, `id`, `describe` (screen-reader wording override, defaults to `describeActiveFilters` (in `filter-count-badge.helpers.ts`, with the `DescribeFilterCount` type) → "N active filters"; the calendar passes `describeHiddenGames` → "N games hidden"), `offset` (`'fab'` 4px corner inset for the 56px FAB, default; `'trigger'` 6px for the 44px toolbar funnel) |
| `button.tsx` → `Button` (ROK-1646) | **The** button. Five variants — `primary` (`bg-emerald-600`), `secondary` (`bg-panel border-edge`), `ghost`, `destructive` (`bg-red-600`), `destructive-soft` (`bg-danger/10 text-danger border-danger/30`) — one disabled treatment (`opacity-50`), a `success` focus ring. `type` defaults to `"button"`. | Every action button. Link-styled actions stay `<Link>`. | `variant` (default `primary`), `size` `md`/`sm`/`lg` (44px below `lg`; `sm` is 36px from `lg`), `loading` (sets `aria-busy` + `aria-disabled` — not native `disabled`, so focus stays — swallows clicks and form submits, keeps the width), `loadingLabel`, `fullWidth`, `iconOnly` (TypeScript then requires `aria-label`), `brandColor` (ROK-1655 — a runtime/provider fill only, §4.11), forwarded ref, all `ButtonHTMLAttributes` |
| `field.tsx` → `Field` (+ `field-context.ts` → `useFieldControlProps`) (ROK-1646) | Label + hint + **inline** error + required marker around one control. Generates the id, renders `<label htmlFor>`, and hands `id` / `aria-describedby` / `aria-invalid` / `aria-required` to the control through context — nested controls included. Error is `<p role="alert" className="text-danger">`. | Every labelled form control. Validation errors go here, not in a toast (§4.8). | `label`, `hint`, `error`, `required`, `hideLabel` (`sr-only`), `id`, `className` |
| `input.tsx` → `Input` (ROK-1646) | The text input on the shared field frame (`form-classes.ts`). | Any single-line text/email/number/password field | `Omit<InputHTMLAttributes,'size'>` + `fieldSize` `md`/`lg`/`sm`, `invalid`, `leading` (icon, adds `pl-10`), `trailing` (interactive, adds `pr-14` so text clears a 44px button), `mono`, forwarded ref |
| `password-input.tsx` → `PasswordInput` (ROK-1655) | `Input` with a trailing 44px `Button ghost sm iconOnly` that flips `type` between `password` and `text`, named "Show <label>" / "Hide <label>", with `aria-controls` on the input. `label` names only the toggle — the input is named by its `Field` (or an `aria-label`). | Every password / secret field (login, first-run admin, API keys) — never `Input type="password"` plus a hand-rolled eye button (§4.11) | `label`, `revealed` + `onRevealedChange` (controlled — one "Show passwords" `Checkbox` driving several fields), every `Input` prop except `type` / `trailing`, forwarded ref |
| `select.tsx` → `Select` (ROK-1646) | The native `<select>` on the shared field frame: `appearance-none pr-9` + a `text-muted` chevron. | Any pick-one-from-a-list field (stays native — no custom listbox) | `Omit<SelectHTMLAttributes,'size'>` + `fieldSize`, `invalid`, `placeholder` (empty-value first option; pair with `value=""`), `wrapperClassName` (default `w-full`), forwarded ref |
| `textarea.tsx` → `Textarea` (ROK-1646) | Multi-line field on the shared frame with an optional counter (`n/max`, `text-xs text-dim`, always visible, joined to `aria-describedby`; not live — an `sr-only` polite region says "N characters left" only in the last 10% of `maxLength`, at most 20). | Reasons, descriptions, notes, feedback | all `TextareaHTMLAttributes` + `invalid`, `fieldSize` `md`/`lg`/`sm`, `showCount` (needs `maxLength`), `resize` `'y'` (default) / `'none'`, forwarded ref |
| `checkbox.tsx` → `Checkbox` (ROK-1646) | Native checkbox, `w-5 h-5 accent-success`, success focus ring. With `label` the whole `<label>` row is the 44px target and the name is the label text alone. | Any boolean in a form or a multi-select list. A single on/off setting is a `Switch`. | `label`, `description` (→ `aria-describedby`), `indeterminate` (sets the DOM property → mixed), `invalid`, all input attributes, forwarded ref. In a `Field`, omit `label` — context wires it |
| `radio-group.tsx` → `RadioGroup` (ROK-1646) | Native radios sharing one `name` in a `<fieldset role="radiogroup">` named by its legend — the browser's Tab/arrow model. `list`: a 44px row per option. `segmented`: `sr-only` radios in a `bg-panel border-edge rounded-lg` track, ON = `bg-overlay text-foreground`, OFF = `text-muted`; the track `flex-wrap`s, so a set wider than its container takes a second row instead of overflowing it. | One choice from 2–6 options. `segmented` for short pill toggles (duration picker, import mode, scope) — never buttons with no radio semantics | `label`, `hideLabel`, `options: {value,label,description?,disabled?}[]`, `value`, `onChange(value)`, `appearance` `'list'` (default) / `'segmented'`, `name`, `disabled`, `className`, `invalid`, `error` (inline `role="alert"`), `aria-describedby` — merged with a surrounding `Field`; `aria-invalid` sits on the radiogroup; ref → the `<fieldset>` |
| `slider.tsx` → `Slider` (ROK-1646) | Labelled native range, `appearance-none` so the thumb sizing applies: label left, a 44px (`h-11`) hit area over a 6px `bg-edge` track filled in `success` to the value, a 20px `bg-success` thumb, `font-mono` `<output aria-live="off">` readout right. Replaces the duplicated `SLIDER_CLS`. | Any bounded numeric filter/threshold — and every sibling in that filter family (§4.11 DON'T) | `label`, `hideLabel`, `value: number`, `onChange(number)`, `min`/`max`/`step`, `formatValue` (readout + `aria-valuetext`), `showValue` (default true), `wrapperClassName`, ref → the input. Renders its own label — don't wrap it in `Field` |
| `search-input.tsx` → `SearchInput` (ROK-1646) | `Input` with `type="search"` (role `searchbox`), a decorative leading magnifier, and — while there is text — a 44px `Button ghost iconOnly` named "Clear search" that empties the box, refocuses it and fires `onSearch('')` at once. The browser's own cancel glyph is hidden. | Every search/filter text box — list pages, picker modals, toolbars. Replaces `ModalSearchInput` (migration: ROK-1647) | `value`, `onChange(string)`, `label` (→ `aria-label`; omit inside `Field`), `onSearch` (debounced, never on mount), `debounceMs` (default 300), `onClear`, plus `Input` props (`fieldSize`, `invalid`, …), forwarded ref |
| `combobox.tsx` → `Combobox` (+ `use-combobox.ts`, `use-anchored-popup.ts`, `combobox-popup.tsx`) (ROK-1646) | **The** autocomplete, in-house WAI-ARIA 1.2: an `Input` (ref forwarded) with `role="combobox"` / `aria-expanded` / `aria-controls` (only while open) / `aria-activedescendant` (focus never leaves it) and a `role="listbox"` at `Z_INDEX.MODAL + 1`, portalled into the surrounding `[role="dialog"]` (so `aria-modal` doesn't hide it) or else `<body>`. Keys are ignored during IME composition; an external reset of `value` to `null` clears the text; one persistent `role="status"` region announces loading / empty / error. Keys: ↑/↓ open then move (wrapping), Home/End jump, Enter picks, Esc closes (a second Esc clears text + value), Tab commits the active option. Closes on an outside press; keeps the active row in view. | Type-to-pick from a long or async list (game search, realm). A short fixed list is a `Select`. Free-text adopter: the realm picker (`plugins/wow/components/realm-autocomplete.tsx`, ROK-1654) passes `inputValue` + `onInputChange` so a typed realm that isn't in the list still reaches the parent, and `value` = the option whose name matches the text exactly (else `null`) | `options`, `getKey`, `getLabel`, `value`, `onChange(option \| null)`, `label` (or `Field`, which also names the listbox), `inputValue` + `onInputChange` (controlled text; omit to let it own the text), `renderOption(option, { active, selected })`, `loading` + `loadingText`, `emptyText` (default "No results"), `errorText`, `placeholder`, `disabled`, `invalid`, `fieldSize`, `portalContainer` (overrides the portal target), `className`, `trailing` (interactive slot at the input's right edge, e.g. a 44px clear `Button ghost iconOnly`), `openOnFocus` (open on focus with nothing highlighted, to offer suggestions before typing), `testIds` (`{ input, popup, option }` → `data-testid` on the input, the popup and every `role="option"` row) |
| `file-picker.tsx` → `FilePicker` (ROK-1655) | A `Button` (default `secondary`) that opens a hidden native `<input type="file" tabIndex={-1}>`. The input's value resets after every pick, so the same file fires twice; `loading` / `disabled` disable both. | Every file upload (avatar, logo, import). Plan ruling 1: a primitive, not a guard exemption for a raw `<input type="file">` | `children` (the trigger's name), `onFiles(File[])` (never empty), `accept`, `multiple`, `loading` + `loadingLabel`, `disabled`, `variant`, `size`, `fullWidth`, `className`, `inputProps` (e.g. `data-testid`), ref → the native input (a drop zone calls `ref.current.click()`) |
| `color-input.tsx` → `ColorInput` (ROK-1655) | A native `<input type="color">` well (44px, `rounded-lg border-edge`, the shared focus ring) named "<label> colour picker", beside a `mono` hex `Input`. The hex field keeps a draft: only a complete `#rrggbb` is reported (lowercased); anything else is `aria-invalid` and reverts on blur. Controlled only. | Any user-chosen colour (a community accent) — the value is caller data, never a theme colour | `value` (`#rrggbb`), `onChange(hex)`, `label`, `disabled`, `invalid`. Inside a `Field` the hex field takes the Field's id / label / hint / error |
| `form-classes.ts` → `FIELD_FRAME`, `FIELD_FRAME_BASE`, `FIELD_PAD`, `FOCUS_RING`, `DISABLED` (ROK-1646) | The class strings the form primitives share | Building the next form primitive (`Select`, `Textarea`, `SearchInput`…) — never re-type the frame | — |
| `bottom-sheet.tsx` → `BottomSheet` | Mobile drawer from the bottom, drag-to-dismiss. Lays out against the VISIBLE viewport: height, cap and bottom edge come from `window.visualViewport` in px via `useVisibleViewport` (`bottom-sheet-viewport.ts`, exposed as `--sheet-vh`), so iPad/iOS Safari toolbars never hide the footer (ROK-1640/1641). Body scroll lock is ref-counted with `Modal` (`hooks/use-body-scroll-lock.ts`), so a confirm stacked over an open sheet can close without unlocking the page | Mobile equivalent of a modal or panel | `isOpen`, `onClose`, `title`, `maxHeight` (default `60vh`, resolved against the visible viewport), `initiallyExpanded`, `ariaLabel`, `footer` (ROK-1655 — a pinned `shrink-0` bar after the scrolling body, `data-testid="bottom-sheet-footer"`), `closeGuard` + `discardMessage` (§4.4) |
| `modal.tsx` → `Modal` (+ `modal-frame.tsx` → `ModalFrame`, the unguarded shell) | Portalled dialog, focus trap + ARIA (ROK-342). A `flex flex-col max-h-[90dvh]` column: `shrink-0` header, a `flex-1 min-h-0` body that scrolls, and an optional pinned `footer` bar (`data-testid="modal-footer"`) that never scrolls away (ROK-1655, §4.4). Feature code imports `Modal`; only `DiscardChangesConfirm` renders `ModalFrame` | Desktop dialogs, confirmations | `isOpen`, `onClose`, `title`, `maxWidth` (default `max-w-md`), `bodyClassName` (replaces only the body skin, §4.4), `footer`, `closeGuard` (from `useDirtyCloseGuard`) + `discardMessage` (§4.4), `initialFocusRef`. The × keeps `aria-label="Close modal"` |
| `discard-changes-confirm.tsx` → `DiscardChangesConfirm` (ROK-1640, shared by ROK-1655) | "Discard your changes?": a `ModalFrame` (so it stacks above a sheet and is never itself guarded) with `secondary` "Keep editing" (focused on open) and `destructive` "Discard" (`data-testid` `discard-changes-keep` / `discard-changes-discard`) | Rendered for you by `Modal` / `BottomSheet` when they get a `closeGuard`. Render it yourself only for a custom overlay | `isOpen`, `onKeep`, `onDiscard`, `message` (default "Your changes haven't been saved yet.") |
| `modal-helpers.tsx` → `ModalSearchInput`, `ModalEmptyState`, `ModalListBody` | Search + empty + list body inside a modal. `ModalSearchInput` is now a thin wrapper that delegates to `SearchInput` (ROK-1647) and still requires a `label` (→ `aria-label`) | Any searchable picker modal. New code uses `SearchInput` directly | see file |
| `fab.tsx` → `FAB` | Floating action button | One primary create action per mobile page — a neutral-toned Filters FAB (§4.1, ROK-1659) may stack directly above it, same right edge, 12px gap; the create FAB keeps the emerald fill | `onClick`, `icon` (default `PlusIcon`), `label` |
| `nav-chip.tsx` → `NavChip`, `NAV_CHIP_CLASS` | Navigational link chip | Linking to a sibling lineup/page from a banner | `to`, `children`, `testId` |
| `switch.tsx` → `Switch` | Accessible on/off switch: native `<button role="switch" aria-checked>`, Space/Enter toggle, `focus-visible` ring, disabled dims + blocks, `bg-success` on / `bg-dim` off (ROK-1612) | Any boolean setting that applies immediately (admin toggles, feature opt-ins). Not for form fields submitted later — use a checkbox | `checked`, `onChange(next)`, `label` (accessible name), `disabled`, `className`, `testId` |
| `new-badge.tsx` → `NewBadge` | "New" marker | Freshly added items | `visible` |
| `plugin-badge.tsx` → `PluginBadge` | Image-only plugin attribution badge | Marking plugin-contributed UI | `icon`, `iconSmall`, `label`, `size` |
| `role-badge.tsx` → `RoleBadge` | Admin (amber) / Operator (emerald); member renders nothing | Showing a user's role | `role`, `className` |
| `loading-spinner.tsx` → `LoadingSpinner` | Full-page spinner | `Suspense` fallback for lazy routes | — |
| `infinite-scroll-sentinel.tsx` → `InfiniteScrollSentinel` | IntersectionObserver "load more" sentinel | Paginated grids | see file |
| `pull-to-refresh.tsx` → `PullToRefresh` | Mobile pull-to-refresh wrapper | Mobile list pages | `onRefresh`, `children` |
| `scroll-collapsible.tsx` → `ScrollCollapsible` | Titled collapsible section | Long secondary content | `title`, `defaultOpen`, `children`, `className` |
| `markdown-text.tsx` → `MarkdownText` | Safe inline markdown (bold/italic/code/link/breaks); raw HTML NOT rendered | Rendering user-authored text | `text`, `className` |
| `CopyButton.tsx` → `CopyButton` | Icon copy-to-clipboard with checkmark + error toast | Copying invite codes, URLs | `text`, `className` |
| `ConnectivityBanner.tsx` | Offline/reconnecting banner | Mounted app-level | — |
| `DiscordJoinBanner.tsx` | Dismissible "join the Discord" banner (ROK-425) | Mounted app-level | — |
| `StartupGate.tsx` | Blocks render until system status resolves | App shell | `children` |
| `ThemeParticles.tsx` | Ambient canvas particles (§2.7) | App shell | — |

### 3.2 De-facto shared components (outside `ui/`)

| Component | Path | Use when |
|---|---|---|
| `game-card-parts.tsx` (`CoverImage`, `CoverPlaceholder`, `RatingBadge`, `GradientOverlay`, `CardTitle`, `GenreBadge`, `HeartButton`) | `components/games/` | Building ANY game tile. Do not hand-roll a cover + title + badge stack. |
| `game-badges.tsx` / `game-badges.helpers.ts` | `components/games/` | Badge row on a game card (sale %, owners, players, early access) |
| `GameRef.tsx`, `GameResearchDrawer.tsx`, `DrawerCard.tsx` | `components/games/` | Inline game reference that opens the research drawer (Cycle 4 U2) |
| `PriceBadge.tsx`, `GameCarousel.tsx`, `ScreenshotGallery.tsx` | `components/games/` | Price pill, tile rail, screenshot lightbox |
| `CommonGroundThemedRow.tsx`, `CommonGroundHero.tsx` | `components/lineups/cycle-4/` | Themed (Owned/Taste/Trending) rows, nomination hero |
| `NominatingComposite.tsx`, `VotingComposite.tsx`, `SchedulingComposite.tsx` | `components/lineups/cycle-4/` | Whole-phase page shells — extend these, don't build a fourth |
| `VoteToggleButton.tsx`, `StarToggleButton.tsx`, `VotesUsedPill.tsx`, `VotingRow.tsx` | `components/lineups/cycle-4/` | Vote/star affordances and the "N of M votes used" pill |
| `HeroNextStep.tsx`, `ConfirmationPill.tsx`, `UserLink.tsx`, `ActivityTimeline.tsx` | `components/common/` | The single through-line "NEXT:" banner, confirmation pill, user mention, activity feed |
| `Layout.tsx`, `Header.tsx`, `Footer.tsx`, `bottom-tab-bar.tsx`, `mobile-page-toolbar.tsx`, `more-drawer.tsx`, `live-region-provider.tsx` | `components/layout/` | App chrome. `live-region-provider` is the a11y announcer — use it, don't `alert()`. The shell's min-height is the VISIBLE viewport, with pinch-zoom and the on-screen keyboard kept out of it and re-read once a rotation settles (a `ResizeObserver` on a hidden fixed layout-viewport sentinel, plus timed reads at 150 and 500 ms; a turn made with the keyboard up floors on the last unfocused height at that width), and `min-h-dvh` as the first-paint fallback (`use-shell-height.ts`). Closing the keyboard on a page no taller than that floor scrolls back to where the field was focused. In DEMO_MODE, `?vpdebug=1` (remembered across tabs until `?vpdebug=0`) shows a live viewport readout just above the footer (`web/src/dev/ViewportReadout.tsx`) for checking a real device. iPad Safari still scrolls or pans any page past the document's end, and fills that area with the root canvas colour (html's `background-color` with body's blended over it; background images don't count). So the canvas (`html`) = `--color-surface`, `body` has no background, and the shell paints `--color-backdrop` — the run-out reads as footer; a chromeless `/p/*` page (no footer, ends on backdrop) keeps the canvas `--color-backdrop` via `html[data-chromeless]`, which `Layout` sets while it renders. Don't set a `body` background, and don't "fix" the band with a taller floor or a footer shadow. The chromeless `/p/*` shell's `<main>` is `flex flex-col`, so a public page fills it with `flex-1` rather than its own `min-h-dvh`; `body` / `#root` carry no `100vh` floor (ROK-1661) — don't add one back. |
| `AvatarWithFallback.tsx`, `RoleIcon.tsx`, `journey-hero/`, `submit-bar/` | `components/shared/` | Avatars, role glyphs, the journey hero and the sticky submit bar |
| `LineupEmptyState.tsx` | `components/lineups/` | The empty-state shape (see §4.5) |
| `player-filters.tsx`, `pages/games/coop-filter-controls.tsx` | filter bodies | Reference implementations of `FilterPanel` children |
| `DurationPresetGroup` (`duration-preset-group.tsx`), `DurationSection` | `components/events/shared/` | Picking an event duration: a segmented `RadioGroup` 'Duration' of the presets you pass in (two lists exist: `shared/event-form-constants.ts` and `reschedule-utils.ts`) plus 'Custom'; value is minutes or `'custom'`, with an `error` slot (`role="alert"`). No asterisk — it always holds a value. `DurationSection` adds the named hr/min number fields for Custom (ROK-1649). |

### 3.3 Shared hooks

| Hook | Path | Use when |
|---|---|---|
| `use-body-scroll-lock.ts` → a ref-counted body scroll lock (ROK-1640, PR #1314) | `web/src/hooks/` | Any modal/sheet that locks background scroll; ref-counted so nested/stacked sheets don't unlock each other early. `Modal` and `BottomSheet` already use it |
| `use-dirty-close-guard.ts` → `useDirtyCloseGuard(isDirty, onClose)` (ROK-1640, shared by ROK-1655) | `web/src/hooks/` | Any overlay that edits data. Returns `{ requestClose, confirming, keep, discard, reset }`: pass it as `closeGuard` to `Modal` / `BottomSheet` and wire an explicit Cancel to `requestClose` (§4.4). A one-macrotask latch stops the Escape that closed the confirm from re-opening it. `Modal` / `BottomSheet` call `reset` (via `useResetGuardOnClose`) when they close by another route or unmount, so the next open never starts mid-confirm |

Toasts come from **`sonner`** — `<Toaster>` is mounted in `web/src/App.tsx:105`; call `toast.success(...)`
/ `toast.error(...)` from `sonner` directly.

---

## 4. Pattern rules

### 4.1 Filtering — the funnel standard (ROK-1659)

**DO** — one shape everywhere a list/grid is filtered, chosen by viewport:

- **Desktop (≥1024px, `DESKTOP_MQ`)** — a toolbar `FilterPanelTrigger` (funnel + active-filter badge)
  opens the inline `FilterPanel`, which owns "Filters" + "Clear all" and scrolls internally past its
  `max-h-[500px]` cap. Reference: `components/ui/filter-entry.tsx` (`FilterEntry` / `FilterEntryTrigger`,
  the standard pairing) and its adopters `pages/games/games-filter-panel.tsx`,
  `components/lineups/CommonGroundFilters.tsx`, `pages/calendar/CalendarFilterEntry.tsx`.
  `pages/players-page.tsx:84-90` wires the lower-level `FilterPanelTrigger` / `FilterPanel` pair directly
  instead of `FilterEntry` (not yet migrated to the shared entry point).
  Escape-to-close is built into `FilterPanel` itself (`useEscapeToClose` + `isEscapeForAnotherLayer` in
  `filter-panel.tsx`) — not a per-page affordance. It closes the desktop panel and, when focus was inside
  it, returns focus to the open funnel (`[data-testid="filter-panel-trigger"][aria-expanded="true"]`),
  because the collapsed panel is `inert`. A non-empty search field inside the panel keeps the first
  Escape (the browser clears it); the next one closes. "Clear all" unmounts itself at 0, so it hands focus
  to the panel's "Filters" title (desktop) or the sheet's Close button first (`ClearAllButton`). Every `FilterPanel` consumer gets this for free, including `players-page.tsx`.
  Below 1024px the same rule holds for the sheet: a closed `BottomSheet` only slides off-screen, so
  `FilterPanel` wraps the sheet body in `inert` + `aria-hidden` while closed (children stay mounted, so
  body effects such as the ROK-1255 auto-seed still run). Tests that drive sheet controls open the FAB first.
- **Phone + tablet (<1024px)** — no toolbar trigger. A floating **Filters FAB** (56px round, `right-4`,
  `lg:hidden` — below 768px it sits above the bottom tab bar: `bottom: 72px` (`FAB_BOTTOM_ABOVE_TAB_BAR`)
  while it shows, `bottom: 16px` (`FAB_BOTTOM_NO_TAB_BAR`) once it hides on scroll. At 768–1023px there is
  no tab bar but the feedback button (`FeedbackWidget.tsx`, a `hidden md:block fixed bottom-6 right-6` wrapper
  round a 48px `Button iconOnly`) holds
  the corner, so the FAB stacks above it: `bottom: 84px` (`FAB_BOTTOM_ABOVE_FEEDBACK` = 24 + 48 + the 12px
  gap) and `md:right-5`, which puts both circles' centres 48px from the edge — computed by
  `useFilterFabBottom`, `components/ui/fab-position.ts`. It is portaled to `document.body`, so a sticky
  toolbar that hosts `FilterEntry` (Common Ground) cannot trap its z-index; a page's bottom padding clears
  the 140px stack at 768–1023px with `md:pb-40`) opens the same `FilterPanel` as a
  `BottomSheet`, which uses its own height cap instead. Neutral tone (`bg-surface border border-edge-strong
  shadow-lg`, funnel `text-foreground`) — it is a secondary trigger, not a page's primary action, so it
  does NOT take the `FAB` primitive's default emerald fill. `aria-label="Filters"`, `aria-describedby`
  naming the count, `aria-expanded`.
- **The badge counts ACTIVE filters, not results** — hidden at zero active filters, on both the desktop
  trigger and the FAB.
- **Stacking** (documented here; `/events` is the live case and out of scope for ROK-1659) — a page's
  create `FAB` and its Filters FAB share the right edge, 12px apart (`FAB_STACK_GAP_PX`,
  `fab-position.ts`): `72px`/`140px` while the tab bar shows, or `16px`/`84px` once it hides — the create
  FAB's own bottom offset plus the 56px FAB height and the 12px gap (`useFilterFabBottom(stackAboveCreate)`);
  the create FAB keeps the emerald fill, the Filters FAB stays neutral, and the page's bottom padding
  clears both (§3.1 `fab.tsx`).
- When a predicate drops NULL-data rows, disclose it in a hint line inside the panel rather than
  silently emptying the grid — `/games` shows `coop-filter-hint` under the Co-op group
  (`pages/games/games-filter-panel.tsx`) and `LibraryFilterHint` / `library-filter-hint` under the
  Players and Owners fields (defined in `pages/games/games-filter-fields.tsx`, mounted by
  `games-filter-panel.tsx`).

On the standard: `/games` (retired the `LfgFilterChip` / `LibraryFilterChips` / `DesktopGenrePills` chip
rows and the genre-only sheet — the Filters FAB opens the full panel instead), Common Ground (retired the
bespoke always-visible card — §6 divergence #1, resolved), Calendar (retired the desktop sidebar chip +
`CalendarGameFilterModal` — the "Filter by Game" FAB becomes the Filters FAB, now visible up to 1024px
instead of 768px).

**DON'T** — render filter controls inline on the page below 1024px with no FAB, leave a toolbar funnel
visible below 1024px alongside the FAB, or fall back to a chip row as a page's filter set (§4.3) — pick
the one trigger the viewport calls for.

**Light / Dark** — panel and sheet are tokens and follow the family; the count badge (`bg-success`) and
the Filters FAB's neutral surface (`bg-surface`/`border-edge-strong`) are tokens too (`design-system-tokens.md` §3).

### 4.2 Cards

**DO** — compose from `game-card-parts.tsx`: `CoverImage` → `GradientOverlay` → `CardTitle` → badges from
`game-badges.tsx`. Card surface is `bg-surface border border-edge rounded-lg`; hover raises to
`hover:bg-overlay` or a border change, via `transition-colors`.

**DON'T** hand-roll a cover + title + rating stack per feature. `card-surface-parity.test.tsx` exists
because surfaces drifted before: one shared component does not guarantee identical surfaces — check them
side by side.

**Light / Dark** — the frame is tokens and flips; the artwork does not (`GradientOverlay` stays dark so
white titles stay legible over the *image*; anything on the art needs `.badge-overlay`). Detail:
`design-system-tokens.md` §3.

### 4.3 Chips and pills

**DO** — the chip geometry is fixed: `inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full
text-sm font-medium transition-colors`, ON = `bg-amber-500/10 border border-amber-500/30 text-amber-300
hover:bg-amber-500/20`, OFF = `bg-panel border border-edge text-secondary hover:bg-overlay`. Rendered as
`<button type="button">` with `aria-pressed`. No product page renders this toggle chip any more: ROK-1659
retired its only adopters, the `/games` chip rows (`library-filter-chips.tsx`, `lfg-filter-chip.tsx`,
both deleted). The geometry survives only in the `/dev/design-system` gallery
(`web/src/dev/design-system/primitives-section.tsx`, `scheme-controls.tsx`).

**DON'T** copy those class strings out of the gallery. The next product surface that needs a toggle chip
promotes them to a shared module (`components/ui/filter-chip.tsx`) and adopts that instead. For
navigation use `NavChip` / `NAV_CHIP_CLASS`, never a hand-written `<Link>` with a pill className. And
don't press a chip row into service as a page's filter set (ROK-1659) — chips are for toggles,
navigation and removable selections (below) only; filtering is §4.1's funnel standard.

**DO — removable selection chip (ROK-1654).** A chip that shows something already picked and lets you remove it
(the event form's selected dungeons/raids, `web/src/plugins/wow/slots/event-create-content-browser.tsx::SelectedChips`,
`:54-67`) is a `<span>` pill, not a button: `inline-flex items-center gap-2 pl-3 min-h-[44px] rounded-full
bg-success/10 border border-success/30 text-sm font-medium text-success`. Put the remove target flush at the
right as a real `Button variant="ghost" iconOnly aria-label="Remove <name>"` (44px, `XMarkIcon` `aria-hidden`).
Secondary text, such as a level range, is `text-xs text-muted`. The pill is not focusable and has no
`aria-pressed`. The named Remove button is its only control, so a screen reader hears "Remove Deadmines,
button" and tests query that name. It is neither the toggle chip above (it has no pressed state) nor a
`NavChip` (it goes nowhere). It has one adopter today; the second surface that needs it promotes it to
`components/ui/` instead of copying the class string. Rendered: `/dev/design-system` → *Primitives* →
"Removable chip".

**Light / Dark** — OFF flips cleanly; of ON's three amber classes only the fill (`:677`) and border
(`:713`) are remapped, so **the ON label is ≈1.4:1 — unreadable in all six light themes** (§6.9). Use
`text-amber-400` on a new ON label until that is fixed. The removable chip is tokens only, so it flips with `success` (`#10b981` →
`#047857`); check both families in the gallery's side-by-side view.

### 4.4 Modal vs bottom sheet

**DO** — pick by viewport, not by taste: `useMediaQuery(DESKTOP_MQ)` (1024px, §4.18) →
`Modal` / inline at 1024px and up, `BottomSheet` below. `FilterPanel` splits at `DESKTOP_MQ` (1024)
internally; copy its `if (!isDesktop)` branch in `FilterPanel` (`filter-panel.tsx`) when you need the
same split elsewhere.

**DON'T** render a desktop `Modal` on mobile and rely on scrolling, or build a custom overlay — `Modal`
carries the focus trap and ARIA dialog semantics you would otherwise have to re-earn.

**Sheet layout rules** (ROK-1640 / ROK-1641):

- **Size against the visible viewport.** Sheet heights are `dvh` with a `vh` fallback — `BottomSheet` converts
  a `vh` `maxHeight` for you. Raw `vh` on iOS/iPadOS Safari excludes the toolbars, so a bottom-anchored
  sheet opened with its last rows (the ⋯ menu's Rally / Lock) under the browser bar.
- **An action footer is a pinned flex footer OUTSIDE the scroll body** — pass it as `BottomSheet footer` /
  `Modal footer` (ROK-1655), which render a `shrink-0` sibling after the scrolling body — `Modal`'s is
  `flex-1 min-h-0`; `BottomSheet`'s is content-sized (`min-h-0 overflow-y-auto`) and shrinks and scrolls
  only once the sheet reaches its `maxHeight` cap (the game-time drawer's `phone-week-check-footer.tsx` `StepFooter` is the hand-built original). Never
  `sticky` inside the scroll body: that is what hid the game-time drawer's Save on an iPad.
- **A sheet that edits data guards its close** — see *Dirty-close* below.
- `web/index.html` has no `viewport-fit=cover`, so `env(safe-area-inset-bottom)` resolves to 0 and the
  sheets' safe-area padding is inert for now — keep it (it activates if the meta tag is ever added), but do
  not rely on it to clear a home indicator.

**Modal footer and body (ROK-1655):**

- **`Modal` is a `max-h-[90dvh]` flex column** — `shrink-0` header, `flex-1 min-h-0` body, optional
  `footer`. Put the dialog's actions in `footer`: a `shrink-0` bar (`border-t border-edge`, right-aligned,
  wraps) below the scrolling body, so Save stays on screen however long the form grows. Never a `sticky`
  row inside the body. A `Modal` / `BottomSheet` pair (`RescheduleModal`) passes the same actions to both:
  both overlays draw the one bar (`OVERLAY_FOOTER_CLASS`, `web/src/components/ui/overlay-footer.ts`), so
  pass the bare buttons — never wrap them in your own `flex justify-end` row.
- **The `bodyClassName` contract:** the structural `flex-1 min-h-0` is ALWAYS applied; `bodyClassName`
  replaces only the skin (default `p-4 overflow-y-auto`). An overrider that drops `overflow-y-auto` owns
  its own scroller — give the child that scrolls `h-full overflow-y-auto`, or it clips at the 90dvh cap.
  The three overriders on main (`GameTimeWidget`, `RescheduleModal`, `GameTimeRefreshModal`) keep their
  behaviour under this contract.

**Dirty-close (ROK-1655) — an overlay that edits data guards its close:**

- **The consumer owns the guard:** `const guard = useDirtyCloseGuard(isDirty, onClose)`
  (`web/src/hooks/use-dirty-close-guard.ts`), then `<Modal closeGuard={guard}>` /
  `<BottomSheet closeGuard={guard}>`. The overlay shows "Discard your changes?" (`DiscardChangesConfirm`;
  `discardMessage` says what is unsaved) while `guard.confirming`.
- **Guarded:** Escape, the backdrop, the header ×, and a sheet's swipe-down — they call
  `guard.requestClose`. An explicit **Cancel** is guarded too: wire it to `guard.requestClose`, not
  `onClose`.
- **Unguarded:** Save and submit close on purpose (`onClose`), as does the confirm's own Discard. A clean
  overlay closes at once on every path — no confirm.
- **Browser back is out of scope** (forms plan ruling 4): no `popstate` handling.
- Rendered: `/dev/design-system` → *Overlays* → the form Modal and form sheet demos.

**Light / Dark** — the body and the footer bar (`border-edge`) are tokens; the scrim is a raw black alpha
with no light override, so it dims identically in both. Do not invent a third — the two that exist already
disagree (§6.11).

### 4.5 Empty states

**DO** — centred, quiet, one sentence that says what to do next: `<div className="text-center py-12"><p
className="text-muted text-sm">No nominations yet. Be the first to nominate a game!</p></div>`
(`LineupEmptyState.tsx`); inside a modal, `ModalEmptyState`. **DON'T** render a full-bleed illustration, a
bordered card, or a bare "No results" with no next step.

### 4.6 Loading

**DO** — `LoadingSpinner` for route-level `Suspense`; inside a component keep the frame and grey the
content instead of swapping in a spinner; `return null` while a gate query resolves (what the dev
wireframe routes do). **DON'T** flash a spinner for a sub-second query, or unmount the page header while
the body loads (layout jump on mobile).

### 4.7 Banners

**DO** — one banner at a time, and prefer the shared through-line: `HeroNextStep`
(`components/common/HeroNextStep.tsx`) is the "NEXT: …" affordance. App-level banners
(`ConnectivityBanner`, `DiscordJoinBanner`) live in the layout and are dismissible where they are not
blocking. Tint = `bg-<hue>-500/10 border border-<hue>-500/30`.

- **Status banners use the tokens**: `bg-success/10 border-success/30 text-success`, the same for `warning` and
  `danger` (`TestResultBanner` in `components/admin/admin-form-helpers.tsx`; ROK-1652 ruling 9 maps red →
  `danger`, emerald → `success`, amber → `warning` 1:1).
- **Instruction callouts are the neutral panel**: `bg-overlay/30 border border-edge rounded-lg p-4`, with
  `text-foreground` headings and `text-secondary` body. Set-up steps are not a status, so they take no hue.
  The admin integration forms use it (IGDB, ITAD, Steam, Co-Optimus, Discord Bot/OAuth, Blizzard; ROK-1652
  ruling 9). A provider's brand appears only as a logo tile (`admin-settings-integration-cards.tsx`'s
  `bg-[#148EFF]`), never as a callout fill.

**DON'T** stack per-phase banners. `/dev/wireframes/simplify` §U1 documents exactly this failure ("Same
job · 4 different shapes") as the thing Cycle 4 removes.

**Light / Dark** — the `-500/10` + `-500/30` pair is remapped for light, but only for `red`, `amber`,
`emerald`, `green`, `yellow`, `indigo`, `cyan` (`:713-735`) — a `blue` or `purple` banner gets none, which
is why instruction callouts use the neutral `bg-overlay/30 border-edge` panel rather than a blue or purple
tint. The token banners and the neutral panel flip with the theme. Keep body copy in `text-foreground` /
`text-secondary`.

### 4.8 Toasts

**DO** — `sonner`'s `toast.success` / `toast.error` for the result of an action the user took;
`CopyButton`'s `copyWithToast` is the reference. **DON'T** toast what the UI already shows, or use a toast
for an error the user must act on — that needs inline text beside the control.

### 4.9 Page header and back navigation

**DO** — `pages/events/EventsPageHeader.tsx` is the reference shape: `mb-8 flex flex-col sm:flex-row
sm:items-center sm:justify-between gap-4` wrapper, an `<h1 className="text-3xl font-bold text-foreground
mb-2">`, a `text-muted` subtitle, and the page's actions in the right-hand slot of the same row (they
stack on mobile). Mobile back/tab affordances come from `mobile-page-toolbar.tsx`. The lighter `border-b
border-edge pb-3 mb-6` + `text-xl font-semibold` variant that dev/wireframe pages use is the *section*
header shape (§4.10), not the page header.

**DON'T** put a bespoke back arrow on each page — mobile back lives in the toolbar, and desktop navigates
via `Header` / breadcrumb links.

### 4.10 Section titles

**DO** — `<h2 className="text-lg font-semibold text-foreground">` with an optional `text-sm
text-secondary` description, separated by `border-b border-edge pb-2 mb-4`. See
`web/src/dev/design-system/design-system-bits.tsx:8-24::Section`.

**DON'T** use `font-display` (Cinzel) for functional section headings — it is for brand/hero moments and
the quest-log theme.

### 4.11 Forms, sliders, checkboxes

**DO** — build forms from the primitives: `Field` around every control, `Input` for text, `Button` for
every action (§3.1). The frame they share lives in `components/ui/form-classes.ts`: `w-full min-h-[44px]
bg-panel border border-edge rounded-lg px-3 py-2 text-base lg:text-sm text-foreground placeholder:text-dim`,
a `focus-visible:ring-2 focus-visible:ring-success/80` ring, `disabled:opacity-50
disabled:cursor-not-allowed`, and `aria-[invalid=true]:border-danger`.

- **Radius is `rounded-lg`** — the same as buttons and §2.5 (operator ruling, ROK-1646; the old `rounded-md`
  field recipe is retired).
- **Focus ring is the `success` token at /80**, `focus-visible` only. /80 is the lowest alpha that clears
  WCAG 1.4.11's 3:1 on `bg-panel` in both families (4.20:1 dark, 3.51:1 light; /50 measured 2.48:1 and
  2.09:1). Buttons add `ring-offset-2 ring-offset-surface`.
- **`text-base` below `lg`** (16px stops iOS Safari zooming on focus), `lg:text-sm` above — the §4.18 split,
  not `sm:`/`md:`. Every control is 44px below `lg`; the only compact size (`fieldSize="sm"`, `size="sm"`)
  applies from `lg` up.
- **Errors are inline** under the field (`Field error=…` → `role="alert" text-danger`, linked by
  `aria-describedby`), never toast-only; a toast is for the result of an action (§4.8).
- **`fieldSize`, not `size`**, on `Input` and `Textarea` — the native `size` attribute is a number.
- **Loading buttons stay focusable**: `Button loading` is `aria-disabled`, not `disabled`, and ignores clicks —
  never hand-roll `disabled={saving}` on top of it.
- **A floating `Button` is positioned by a wrapper `<div>`**, never through its `className`: there is no
  tailwind-merge, so `hidden`/`md:flex`/`rounded-full` on the button fight its own `inline-flex`/`rounded-lg`.
  The wrapper owns `fixed`, the breakpoint display and the shape (`[&>button]:rounded-full [&>button]:p-0`,
  which out-rank single-class utilities) — `FeedbackWidget.tsx`'s FAB (ROK-1651). Button has no FAB mode.
- **`RadioGroup` validates like a field**: `error` / `invalid` put `aria-invalid` on the radiogroup and the
  inline alert under it.
- **`Select`** stays native (`appearance-none` + chevron); `placeholder` is an empty-value first option.
  **`Textarea`** counters come from `showCount` + `maxLength` — don't hand-roll one (ReasonField and
  FeedbackDialog both use `showCount`).
- **Checkboxes and radios are native**, `w-5 h-5 accent-success`, inside a `<label>` so the text is part of the
  44px target (`Checkbox`, `RadioGroup` list). A pill/segmented toggle is `RadioGroup appearance="segmented"` —
  real radios, so it has `radiogroup` semantics and arrow keys; never a row of buttons with no state. Its track
  wraps rather than overflowing a narrow card (six duration segments at 375px take two rows) — never give it
  `flex-nowrap` or a fixed width. Segments never shrink below their longest word, so when a wrapped row would
  read badly, switch to `appearance="list"` below `sm` with `useMediaQuery('(min-width: 640px)')` (FeedbackDialog's
  four categories need ~327px against ~287px) rather than a sideways-scrolling row.
- **Sliders are `Slider`**: `appearance-none` with a painted `bg-edge` track, `success` fill and 20px thumb in a
  44px hit area, a `font-medium` label left and a `font-mono` readout right (`aria-live="off"`);
  `formatValue` doubles as `aria-valuetext`.
- **Search boxes are `SearchInput`**: always named (`label` or a `Field` with `hideLabel`), one 44px "Clear
  search" button, `onSearch` for the debounced query — don't hand-roll a magnifier + `setTimeout`.
- **Type-to-pick is `Combobox`** — never a bare `<ul>` of results under an input (the old game-search pickers
  had no `role="combobox"` and no keyboard path). The popup is `bg-surface border border-edge rounded-lg
  shadow-xl`, the active row `bg-overlay`, rows 44px below `lg`; async lookups pass `loading` / `emptyText` /
  `errorText` (a status row, announced by one persistent `role="status"` region) instead of rendering their own
  spinner. Inside a Modal or BottomSheet the popup portals into the dialog and the first Esc closes only the popup.
- **Passwords and secrets are `PasswordInput`** (ROK-1655, forms plan ruling 2): inside a `Field`, with
  `label` naming the toggle ("Show Password" / "Hide Password"). Several fields revealed together → one
  "Show passwords" `Checkbox` driving each field's controlled `revealed`. Never `Input type="password"`
  plus a hand-rolled eye button.
- **Admin integration forms** (IGDB, ITAD, Steam, Co-Optimus, Discord Bot/OAuth, Blizzard, AI providers;
  ROK-1652) use the thin adapters in `components/admin/admin-form-helpers.tsx`. Secrets go through
  `PasswordInput`, which wraps the ui `PasswordInput` at `fieldSize="lg"` and names its toggle "Show API key" /
  "Show password". Copyable values (Redirect URI, callback URLs) use `CopyableInput`: a `readOnly` `Input` with
  a trailing ghost icon `Button` named "Copy <label>". Enter and a click on the field also copy. The action row is
  ONE shared component, `components/admin/integration-form-actions.tsx` → `IntegrationFormActions` (`isPending`,
  `showTest`, `showClear`, `onTest`, `onClear`; the copy lives in it): Save `primary` (`lg`), Test `secondary`, and
  Clear `destructive-soft`, all with `loading`. Below `lg` Save is a full-width row (`w-full`) with Test and Clear
  under it, each label `whitespace-nowrap` so nothing wraps at 375px; from `lg` Save is `flex-1` beside them. Never
  hand-roll the triad per form (Co-Optimus keeps its own row and shorter labels, laid out the same way: full-width Save below `lg`). Secondary actions use `secondary`, not a brand or ring hue (ruling 10): Sync Now (IGDB),
  Test Permissions (Discord Bot) and Set as Active (AI providers). No per-integration `ringColor` or `*_RING`
  constant remains.
- **File uploads are `FilePicker`** (ruling 1): the trigger is a `Button` named by `children`; the native
  input stays hidden in the DOM (tests drive it with `userEvent.upload`). A drop zone reuses the picker's
  ref to open the same dialog instead of rendering a second `<input type="file">`. A raw file input gets
  no guard exemption.
- **Colours are `ColorInput`** (ruling 1): well + mono hex inside a `Field`. The value is caller data (a
  saved accent), never a theme colour; presets and Reset set `value` and the draft follows.
- **Brand fills are `Button brandColor`** (ruling 3): a provider's runtime colour (`provider.color`,
  Discord `#5865F2`) as an inline fill. It replaces the variant's classes and adds `data-brand-fill` +
  `text-foreground`. On the six light schemes the index.css forced-white rule (`:797-805`) sets it to
  `#fff`; on the dark schemes it stays `text-foreground`, which is already near-white there — so the
  label reads light on every scheme, but is pure white only on the light ones. Theme colours use the variants: never pass a token or a
  hand-picked hex to `brandColor`, and never hand-write `bg-[#hex]` on a button.
- **A segmented filter with an "All" option uses a sentinel value** (ROK-1653, ruling 6). `RadioGroup`
  values are strings, so "no filter" is a reserved value (`'__all__'`) mapped to `null` at the boundary:
  `value={active ?? ALL}`, `onChange={(v) => set(v === ALL ? null : v)}`. "All" is the first option and the
  only reset — a radio can't be un-checked, so re-clicking the checked option does nothing (the old
  toggle-to-clear pills are gone). Counts go in the labels (`All (12)`). When the options outgrow a phone,
  wrap the group in `max-w-full overflow-x-auto` and pass `className="[&_label]:whitespace-nowrap"` so the
  track scrolls inside its own box. Reference: `pages/admin/cron-jobs-panel.tsx::ThemeFilter`. Per-option
  hues (the cron themes' colours) are dropped — the segmented ON state is the one treatment.
- **Row action menus are `Button` rows** (ROK-1653, ruling 10): a `role="menu"` popover (`bg-panel
  border-edge rounded-lg shadow-lg p-1`) of `<Button role="menuitem" variant="ghost" size="sm" fullWidth>`,
  with `destructive-soft` for the destructive rows (Kick / Ban / Remove) — no new tone prop. `Button`
  centres its label and has no tailwind-merge, so a `justify-start` override is unreliable; left-align by
  widening the label span instead: `className="[&>[data-button-label]]:w-full"` (the span's own
  `inline-flex` then packs icon + text from the left). Reference:
  `components/admin/UserManagementRow.tsx::ActionMenuList`. That menu dismisses on Esc and outside click
  only; the §4.14 dropdown (`SchedulingManageDropdown`) is the one with full arrow/Home/End menu keys.

**Guard:** `components/ui/form-primitives.guard.test.ts` freezes raw `<input>` / `<select>` / `<textarea>` /
`<button>` outside `components/ui` and `dev` at `form-primitives.baseline.json`. The list only shrinks: a new
file or a higher count fails; a migration that lowers a count fails until the baseline is lowered to match.

**DON'T** hand-write an input or button class string, use a `bg-*-800` disabled fill, spell an error
`text-red-400`, or put a number input where the family around it uses sliders — the operator ruled on
that (2026-08-20) so a filter group reads as one control family. Don't paint a checkbox with `text-emerald-500`
/ `focus:ring-*` (`@tailwindcss/forms` isn't installed — those do nothing) or an `accent-[#hex]`. `ModalSearchInput`'s `focus:ring-accent`
resolves to nothing (§6.3); `SearchInput` replaces it. Don't add a headless combobox library — `Combobox` is
the in-house one (operator ruling, ROK-1646).

**Light / Dark** — the frame is tokens and flips; the ring flips with `success` (`#10b981` → `#047857`); the
solid `primary`/`destructive` fills are identical in both with the label forced white on light (§6.10).
Native control chrome follows root-only `color-scheme` (`:617-631`) — check sliders and checkboxes at the
ROOT, not in a scoped preview (`design-system-tokens.md` §3). A `brandColor` fill is the caller's data and
does not flip; its label is white in both. Rendered: `/dev/design-system` → *Forms*
(`web/src/dev/design-system/forms-section.tsx` + `forms-pickers-demo.tsx`).

### 4.12 Badges with counts

**DO** — absolutely-positioned circle on the trigger: `absolute -top-1 -right-1 flex items-center
justify-center min-w-5 h-5 px-1 text-xs font-bold text-white bg-success rounded-full`
(`filter-count-badge.tsx::FilterCountBadge`, ROK-1659 — shared by `FilterPanelTrigger` and `FilterFab`;
`min-w-5 px-1` over a fixed `w-5` so a two-digit count doesn't clip). Inline count pills use `px-2 py-0.5
text-xs rounded-full` with a tinted background.

**DON'T** show a zero-count badge — `FilterCountBadge` renders nothing at `count <= 0`.

**Light / Dark** — a solid-fill badge is identical in both by design (§6.10) whether it is a raw hue or,
as here, the `success` token; a tinted pill must use `bg-<hue>-500/10` + `text-<hue>-400` to pick up the
remap.

### 4.13 Journey hero — one component, every phase, every width

**DO** — mount `JourneyHero` (`web/src/components/shared/journey-hero/JourneyHero.tsx`) for any lineup or
scheduling-poll phase card; it is the same component on phone and desktop. Top to bottom it renders
(`:201-229`): badge line → **headline row first** (the task copy, prefixed by a 20px `bg-success` ✓ disc
once the viewer's part is done, `:163`) → a **4px progress line** (`h-1`, `:54`) with a `step N of M` meta
→ cta / exit-condition / cue / hint → the full-width `manage` slot (`:226`).

- **Chip slot.** The headline row's right cluster takes the `action` chip then ONE `headerAction`
  (`HeroHeadline`, `:118-139`). The cluster is `CONTROLS_CLS` (`:29-30`): `flex-none` on a phone,
  shrinkable and capped at `lg:max-w-[44%]` from `lg`, while the headline keeps `lg:basis-[56%]` and never
  shrinks (`:146`) — the controls wrap onto a second line first.
- **Progress line.** Replaces the old dot ribbon but keeps its semantics: `<ol aria-label="Lineup
  progress">` with `aria-current="step"` (`:35`, `:74`) — smoke specs and assistive tech depend on it. The
  fill is `bg-success` on the `action` tone, `bg-edge-strong` otherwise (`:51`); `hideSchedulePhase` drops
  the fourth label, `noRibbon` drops the line.
- **Tone borders.** `BORDER_CLS` / `BADGE_CLS` (`:14-24`): `action` = `border-success/30` + `text-success`,
  `waiting` = `border-edge` (neutral), `set` = `border-warning/30` + `text-warning`. `waiting` / `set` also
  get the done pill (`"✓ You're done here"` / `"✓ You're set"`, `pillLabelFor`, `:104-109`).
- **Manage slot.** Phones pass the Manage row in `manage`; desktop passes the dropdown in `headerAction`
  instead — see §4.14 (`SchedulingToolbar.tsx:58-80` is the reference wiring).

**DON'T** fork a per-page hero, re-add the dot ribbon, or put a second button in `headerAction` — one
control per phase, and everything else goes in Manage.

**DON'T** "fix" the inline CTA's `bg-emerald-600` (`HeroCta`, `:172-178`) to `bg-success`: `index.css`
forces the white label off that exact class, so the token would ship a dark label on the light schemes
(§2.2 D-6). Conversely the ✓ disc's `bg-success text-white` (`:163`) is correct as written.

Rendered: `/dev/design-system` → *Pattern — journey hero* (`web/src/dev/design-system/hero-section.tsx`).

**Sheet vs shipped** (hero sheet v8, §7 row 1): the sheet says the chip "shortens to the count + avatars on
phones"; what ships is `LineupParticipantsButton size="touch"` — label + up to four avatars at every width
(`LineupParticipantsButton.tsx:99-103`), with the `aria-label` carrying the full name. Treat the shipped
form as current until the operator rules otherwise.

### 4.14 Manage — a sheet on phones, a dropdown on desktop

**DO** — one trigger labelled `Manage poll ⋯`, one action list (Add Participants / Remind Voters / Cancel
Poll), two shells chosen by `useMediaQuery(DESKTOP_MQ)` (`lib/breakpoints.ts:15`):

- **Below 1024px** — `SchedulingManageButton` (`web/src/components/lineups/cycle-4/SchedulingManageSheet.tsx:95-118`)
  in the hero's `manage` slot: a full-width 44px row (`SCHEDULING_MANAGE_BUTTON`,
  `scheduling-action-button.ts:45-49`) opening a `BottomSheet` of 52px rows.
- **1024px and up** — `SchedulingManageDropdown` (`SchedulingManageDropdown.tsx:27`) in the hero's
  `headerAction`: a 36px trigger opening a 232px `role="menu"` popover (`:75`) with menu keyboard handling
  (arrows wrap, Home/End, Esc returns focus). The popover stays **mounted** and toggles `hidden`, because
  each action owns its own confirm modal.

Both shells render the SAME action components (`variant="row"`), so hooks, gates and in-flight copy are
never duplicated. Members and read-only polls get nothing (`useCanManagePoll`).

**DON'T** build a third shell, a phone-only modal, or a row of buttons in the hero header (the ROK-1582
overflow this replaced). A new creator action is a new row in both shells, not a new button.

Both shells are tokens only (`bg-surface`, `border-edge(-strong)`, `hover:bg-overlay`) — no raw hues to
migrate; they flip with the family.

### 4.15 Week strip — three bands, two tones, a busy cap

**DO** — use `WeekStrip` (`web/src/components/features/game-time/phone/WeekStrip.tsx`) for any
seven-day-at-a-glance picker. Each day is **three bands** (`STRIP_BANDS` — day / evening / late,
`phone-week.utils.ts`), each one bar (`BandBar`, `:201-225`):

- **Viewer mode** — `full` / `partial` / `none` (`bandKind`, `phone-week.utils.ts:109`) painted
  `bg-success` / `bg-success/50` / `bg-edge` (`BAND_FILL`, `week-strip.fills.ts`). Never a busy cap.
- **Group mode** — `all` / `most` / `few` / `none` (`groupBandKind`, `group-day.utils.ts:144`; thresholds
  ≥ 0.999 / > 0.5 / > 0 mirror `computeHeatmapBg`), painted by the success → warning → danger ramp
  `bg-success` / `bg-warning/70` / `bg-danger/50` / `bg-edge` (`GROUP_FILL`). A band reports its **best**
  hour, so the bar agrees with the cells the viewer sees after tapping.
- **Two-tone (best / other).** A band whose hours disagree paints BOTH tones split by a sliver of
  `--color-surface`: class `.strip-bar-split` (`index.css:88-93`, a 105° gradient 0–46% / 46–54% /
  54–100%) fed `--bar-l` / `--bar-r` from `GROUP_GRADIENT` (`WeekStrip.tsx:213-214`). `GROUP_GRADIENT` is
  `GROUP_FILL` spelled as `color-mix(in oklab, var(--color-…) N%, transparent)` — a **matched pair**,
  asserted key by key in `WeekStrip.test.tsx`; keep `in oklab` (Tailwind's own `/70` interpolation).
- **Busy cap.** A band containing an hour someone is committed in wears `bg-busy` on its **right 30%**
  (`absolute inset-y-0 right-0 w-[30%]`, `:217-220`), on solid and two-tone bars alike — not a
  full-height overlay, not a dot.

**DON'T** introduce a second colour language for the same data, hand-write an rgba gradient (the maps are
exported for reuse), or change one map without the other.

Rendered: `/dev/design-system` → *Pattern — week strip* (`web/src/dev/design-system/week-strip-section.tsx`).

### 4.16 Busy marker + label grammar

**DO** — "someone is committed elsewhere in this hour" is a **left edge, not a fill**; the heat fill under
it is untouched. Classes live in `web/src/components/features/game-time/week/group-marks.classes.ts`:
`BUSY_EDGE_4` (4px, the desktop week cell, `:11-13`) and `BUSY_EDGE_5` (5px, the wider phone day row,
`:15-17`), both `before:bg-busy`. The same file owns the other marks — `SLOT_MARK` (2px dashed
`outline-slot`, inset 3px), `PICKED_MARK` (`ring-success`), `DISABLED_MARK` — composed by
`weekCellClass`.

The label is a **count clause**, never a standalone badge: the busy part is appended to the free count as
`" · N busy"` (`groupCellBusyLabel`, `group-day.utils.ts:57-66`; long form `N free · N stale · N busy · N unknown`,
`grid-cell.utils.ts:84-99`) and rendered in `<b className="font-medium text-busy">` beside the foreground
free count (`GroupWeekCell.tsx:27`, `GroupDayView.tsx:196`). It reads `2 free · 1 busy`.

**DON'T** paint a busy hour purple, drop the clause into a pill, or hand-write another `before:` edge.
Known drift: `GroupDayView.tsx:149` still declares a local `BUSY_EDGE` identical to `BUSY_EDGE_5` instead
of importing it — reuse the export when you next touch that file.

Rendered: `/dev/design-system` → *Pattern — group marks and legend* (`web/src/dev/design-system/group-marks-section.tsx`).

### 4.17 The hours window

**DO** — every game-time grid defaults to the **evening** and opens both ways with `▴ Show earlier` above
and `▾ Show later` below, so all hours stay reachable. Two things are true at once (spec §4.3 row A):

- **Base window: 6 PM – 1 AM.** The profile Game Time surfaces — phone drawer (`splitHourRange`,
  `web/src/components/features/game-time/phone/phone-window.helpers.ts:46-52`) and desktop profile grid
  (`desktopHourRange`, `:72-76`; `use-desktop-profile-window.ts:7`) — show every hour outside the two
  bands.
- **Full range: 6 AM → 5 AM.** `EARLIER_HOURS` = 6 AM – 6 PM (`:32`), `LATER_HOURS` = 1 AM – 6 AM
  (`:35`), labelled `▴ Show earlier (6 AM – 6 PM)` / `▾ Show later (1 AM – 6 AM)`
  (`use-desktop-profile-window.ts:17-19`). The profile surfaces remember the choice per device
  (`rl.gameTime.profileWindow`).
- **Poll surfaces use `CHECK_HOURS`** (`phone-week-check.helpers.ts:21`, hours 17–23): the week-check
  drawer (`PhoneWeekCheckStep`), `PhoneGroupAvailability`, and the desktop group week view
  (`useWeekHours`, `week/use-week-hours.ts:47-56`, whose rows read 5 PM – 11 PM; its bands are 6 AM – 4 PM
  and 12 AM – 5 AM).
- **Auto-open.** A band opens by itself while a required hour (a slot mark, a pick, the current start, a
  claimed hour) lies inside it, until the viewer toggles it — **the explicit toggle then wins and is not
  persisted** (`use-week-hours.ts:26-38`).

**DON'T** add a third hour constant or a per-page window; import these.

**Sheet vs shipped:** the sheet specifies one evening window (6 PM – 1 AM) everywhere. The poll surfaces
ship `CHECK_HOURS` (hour 17 first) instead, so the desktop group week view starts at 5 PM and ends at
11 PM. Documented as it ships; aligning it is a product call, not a docs fix.

### 4.18 Tablet breakpoint — phone layouts below 1024px

**DO** — the phone/desktop split is **1024px (`lg`), not 768px (`md`)**: iPads in portrait (768–834px)
and the iPad mini in landscape get the phone layouts (sheets, drawers, one-day module, Manage sheet). In JS
import `DESKTOP_MQ` / `PHONE_MQ` from `web/src/lib/breakpoints.ts:14-18` and pass to `useMediaQuery`
(e.g. `SchedulingToolbar.tsx:50`, `FilterPanel` in `filter-panel.tsx`); in CSS use `lg:` on the same component so the
two halves agree (the toolbar's `lg:sticky`, `SchedulingToolbar.tsx:54`). Known drift: `Layout.tsx:48`
hand-writes `'(min-width: 1024px)'` — right value, wrong spelling; switch it to `DESKTOP_MQ` when next touched.

**DON'T** hand-write `'(min-width: 768px)'`, or put an `md:` prefix next to a `DESKTOP_MQ` check — that
is a tablet bug. Pages outside the scheduling / game-time / profile surfaces keep their own breakpoints
until someone moves them deliberately.

### 4.19 Legend copy (group week view)

**DO** — the desktop group week view's key is `GroupWeekLegend`
(`web/src/components/features/game-time/week/GroupWeekLegend.tsx:28-44`): four keys in this fixed order,
verbatim — **More people free · Someone busy · Your events · Already suggested** — plus a right-aligned
members clause (`membersClause`) only when freshness data exists. Each swatch is painted by the **same**
helper the cells use: `computeHeatmapBg({ available: 1, total: 1 })`, `BUSY_EDGE_4`,
`getGameTimeBlockStyle`, and `border-dashed border-slot`.

**DON'T** hand-draw an approximate swatch or reword a key; a new mark gets a new key in the same
component. (The legend came in with ROK-1588; hero sheet v8 has no legend.)

### 4.20 Touch chip + pill recipe (44px)

**DO** — a tappable chip in a phone hero or toolbar is at least 44px tall. The shipped recipe is
`LineupParticipantsButton`'s `touch` size (`web/src/components/lineups/LineupParticipantsButton.tsx:37-38`):
`inline-flex items-center gap-2 rounded-full border min-h-[44px] px-3 py-2 text-sm border-edge-strong
bg-surface text-foreground`, dropping to a 36px chip from `lg` (`lg:min-h-[36px] lg:px-3 lg:py-0
lg:text-xs`, `:28`). `hero` = compact pill below `lg` + the same 36px desktop chip; `compact` = the
archived-header pill. Reuse the component (or its `SIZE_CLS` entry) — never a copy of the string.

**DON'T** confuse this with the §4.3 *filter* chip (an `aria-pressed` toggle with an amber ON state): the
touch chip is a secondary button on the surface, tokens only, identical grammar in both families.

---

## 5. Rendered reference

`/dev/design-system` (DEMO_MODE only) renders the swatches, the most-reached-for primitives in their
default / hover / disabled / loading / empty states, and the §4.1 DO-vs-DON'T side by side. It does not
mount `PluginBadge`, `InfiniteScrollSentinel`, `PullToRefresh`, `ConnectivityBanner`, `DiscordJoinBanner`
or `StartupGate` — §3.1 is the complete list. A scheme switcher covers all fifteen themes and a "Side by
side" toggle shows the light and dark families at once. Source: `web/src/dev/design-system/`; gating is
the shared dev-route pattern (`useSystemStatus()`, `null` while loading, `<Navigate />` when `demoMode !==
true`), registered in `lazy-routes.ts` + `app-routes.tsx`.

The ROK-1586 sections render the §4.13–4.19 patterns from the shipped maps and helpers, not copies:
*Semantic colour tokens* (`semantic-tokens-section.tsx` — solid / border / tint / text per token, and the
D-6 solid-button DO/DON'T), *Pattern — journey hero* (`hero-section.tsx`), *Pattern — week strip*
(`week-strip-section.tsx`) and *Pattern — group marks and legend* (`group-marks-section.tsx`). Check both families there before
changing any of them.

---

## 6. Known divergences

Found while reading the code for this document. Each is a candidate unification story — the Lead files
them; do not fix them as scope creep.

1. ~~**`CommonGroundFilters` vs `FilterPanel`**~~ (`components/lineups/CommonGroundFilters.tsx` vs
   `components/ui/filter-panel.tsx`) — **Resolved by ROK-1659:** the bespoke always-visible card is
   retired; Common Ground's three controls (min owners, players, co-op) moved into `FilterEntry` children
   behind the same Filters FAB (phone/tablet) / toolbar funnel (desktop) as `/games` (`/players` is not
   yet migrated — it still wires the lower-level `FilterPanelTrigger` / `FilterPanel` pair directly, shown
   at every width, §4.1). Common Ground has no genre control. The auto-seed hook (ROK-1255),
   restore/suppress (ROK-1400) and co-op dormancy moved across unchanged. The badge counts co-op only —
   min owners 2 and auto-seeded players are defaults and don't count.

2. ~~**Chip class strings duplicated across two files**~~ (`pages/games/library-filter-chips.tsx` vs
   `pages/games/lfg-filter-chip.tsx`) — **Resolved by ROK-1659:** both files were deleted when `/games`
   retired its chip rows for the Filters entry (§4.1), so no product page carries the duplicated
   `BASE_CLS` / `ON_CLS` / `OFF_CLS` any more. The geometry lives on only in the `/dev/design-system`
   gallery (§4.3); a future product adopter promotes it to `components/ui/filter-chip.tsx`.

3. ~~**`--color-accent` is referenced but never defined**~~ — **Resolved by ROK-1645.** Every call site
   was replaced rather than the token declared (operator ruling 2026-09-22: "accent" means nothing distinct
   from `success`): solid fills are `bg-emerald-600 hover:bg-emerald-500 text-white` (forced-white list),
   tints/text are `*-success`, focus rings `ring-success/80`. The same sweep removed the other undeclared
   utilities — `ring-primary`, `text-primary`, `bg-base`, `bg-bg`, `text-heading`, `bg-panel-hover`,
   `var(--color-border)`. `web/src/styles/undefined-tokens.guard.test.ts` now fails on any colour utility
   or `var(--color-*)` whose token is not declared in `index.css` `@theme` (78 hits before the fix).

4. ~~**Search input styling lives in three places**~~ — **Resolved by ROK-1646/1647.** `SearchInput`
   (`components/ui/search-input.tsx`) is the one search box: `ModalSearchInput` delegates to it and the
   Discover-tab, list-page, picker-modal and toolbar searches use it; game search is the shared `Combobox`.
   Common Ground's last hand-rolled box went with ROK-1659/1662 (`CommonGroundPanel.tsx` uses `SearchInput`).

5. **Empty states are ad-hoc** — `LineupEmptyState` for one surface, `ModalEmptyState` for modals, inline
   centred `<p>` elsewhere. *Suggested:* one `components/ui/empty-state.tsx` taking `{ title, action? }`.

6. **`InviteeList` row vs `NavChip`** — `nav-chip.tsx`'s header documents that `InviteeList` was
   deliberately left out (it is an `<li>`, not a link). Recorded so the next reviewer does not re-raise
   it: **intentional, not a divergence to fix.**

7. ~~**Semantic accents are untokenised**~~ — **Resolved by ROK-1586 PR A (#1305):**
   `--color-success` / `--color-warning` / `--color-danger` are declared in `@theme` and the shared light
   block (§2.1), guarded by `web/src/styles/semantic-tokens.guard.test.ts`, and used by the journey hero,
   week strip and week-cell marks. **What remains:** every other call site still spells the meaning as a raw
   `emerald` / `amber` / `red` hue and still leans on the per-hue overrides (`index.css:681-759`) — the
   repo-wide sweep is a report-only backlog item (`TECH-DEBT-BACKLOG.md`, 2026-09-22), not a story. The
   §6.3 `--color-accent` gap is resolved (ROK-1645).

8. **Dark tokens are root-only; light tokens cascade.** Light schemes declare their values on
   *unqualified* `[data-scheme=...]` selectors (`index.css:106`, `:199`, `:251`, `:303`, `:355`), which
   match a nested `<div data-scheme="sky">` as happily as `<html>`. The dark values live on `@theme`
   (`:32`) and `html` (`:96`) with no `[data-scheme="dark"]` block at all, so a scoped dark wrapper inside
   a light root inherits the LIGHT tokens. Nothing can preview dark in a scope — which is why
   `/dev/design-system` pins the ROOT to `default-dark` while its side-by-side view is on. *Suggested —
   its own story, NOT this spike:* a qualified `[data-scheme="dark"]` token block mirroring the light
   ones. It changes the live default theme, and appended at the end of `index.css` it would win the
   cascade over every earlier rule of specificity ≤ (0,1,0) that overrides those tokens for dark
   (including `html { --gt-* }` at `:96`) — so it needs a full Playwright pass plus a visual check in
   `default-dark` and `default-light`.

9. ~~**Two accent shades have no light-family override**~~ — **fixed (ROK-1586):** `text-amber-300`,
   `text-red-300`, `text-indigo-300` and `text-blue-300`/`-400` are now repainted beside the others at
   `:688-705`, and every repaint is measured on the surface, panel and its own `/10` tint by
   `raw-hue-light.guard.test.ts`.

10. **Solid accent fills are identical in both families** — `bg-emerald-600` buttons and the
    `bg-emerald-500` count badge do not move, label forced white on light (`:780-787`). Recorded because
    it reads as a miss: it is deliberate — and it is why solid button fills were NOT tokenised by
    ROK-1586 (§2.2).

11. **The two overlay scrims disagree** — `Modal` `bg-black/60 backdrop-blur-sm` (`modal-frame.tsx:98`) vs
    `BottomSheet` `bg-black/50`, no blur (`bottom-sheet.tsx:105`). Neither has a light override, so both
    feel heavier on a white page. *Suggested:* one scrim constant.

---

## 7. Approved design references

The operator approves designs as claude.ai artifacts (prototype sheets) before the implementing stories
are filed. This is the index — an agent implementing any of these surfaces implements the approved
target, it does not redesign it. Local copies under `planning-artifacts/` (gitignored, on the operator's
machine) mirror the artifacts; `grep -rl "<distinctive phrase>" planning-artifacts/design-*` before calling
a reference unreachable. Add a row when the operator approves a new sheet; strike a row only when the
surface it describes is retired.

| # | Design (approved) | Artifact | Local copy | Implemented by | Still open |
|---|---|---|---|---|---|
| 1 | **Hero sheet v8** (2026-09-16) — H1-b `JourneyHero` on every phase (headline row + participants chip, progress line replaces the ribbon, `manage` slot), Manage sheet on phones / dropdown on desktop, link-glyph share, week strip two-tone bars + purple busy cap, purple busy cells + label grammar, Profile → Game Time drawer in place, hours 6 AM → 5 AM with ▴ earlier / ▾ later, tablets < 1024px on the phone layouts | https://claude.ai/artifact/Cv3kCM2bqkpdhDwiugRxRV | `design-poll-hero-second-pass-2026-09-16.html` | ROK-1584 + ROK-1583 (phone round, PR #1243), ROK-1585 (desktop round, PR #1245), ROK-1586 (semantic tokens PR #1305; patterns §4.13–4.20 of this doc) | — (shipped deviations from the sheet are noted in §4.13 and §4.17) |
| 2 | **Poll drawer one-view** (2026-09-16, v4) — one game-time check drawer with no stepper; "Find a better time" on phones = the one-day editor in group mode (counts right-aligned, "You" outline, tap to suggest, week strip = the group); More drawer → Game Time | https://claude.ai/artifact/Y8Nn7V4ZPiF5CHQxmzmnD9 | `design-poll-drawer-one-view-2026-09-16.html` | ROK-1579 (frame 1, PR #1238), ROK-1580 (frame 2, PR #1239), ROK-1583/1584 (frame 3, PR #1243), ROK-1587 (existing slots on the phone day view, PR #1250) | — |
| 3 | **Phone game-time editor, Option A** (2026-09-14) — one day per screen with ‹ › + swipe, block editor filling the sheet, 7-column week strip as the day picker, full-width "Same as last week", inline "I'm away…", sticky Save/Skip. Rejected: day-chip tabs, copy-to-weekdays, the 3-day window | https://claude.ai/artifact/PRCNFBYTvYkrnWy3gEpfrK | memory `reference_game_time_mobile_design` | ROK-1574 (PR #1230) | — |
| 4 | **Game-time block editor** (ROK-1426) — blocks with drag handles instead of painted cells, on the profile grid and the widget | https://claude.ai/code/artifact/1cf14459-5746-4b78-b234-e85429b1af0f | memory `reference_game_time_mobile_design` | ROK-1426 (PR #1053) | The **group availability heatmap** (`GameTimeGrid` + `heatmapOverlay`, painted cells) is NOT this design and is **retired — ROK-1588** (PR #1250, `e96c026b3`): `features/heatmap/` and `heatmapOverlay` are gone; desktop "Find a better time" and Reschedule use the week-columns view (§4.16, §4.19). `computeHeatmapBg` (`grid-cell.utils.ts:67`) **deliberately survives** as the fill helper — `GroupWeekCell`, `GroupDayView`, `GroupWeekLegend`, `PhoneGroupAvailability` paint with it (an alpha that encodes data, §2.2 exemption). Do not re-file it as dead code. |
| 5 | **Cycle 4 Unify** — simplified lineup flow wireframes | `/dev/wireframes/simplify` (DEMO_MODE; sources `web/src/dev/simplify-wireframes/*`) + Figma `ROK-929 Community Lineup Prototypes` | memory `reference_cycle_4_unify_design` | the Cycle 4 stories (ROK-1300 family) | — |
| 6 | **Embed system** + **Looking For Group** sheets (2026-09-01) — one grammar for every bot embed; async LFG matchmaking | (text extracts) | `design-embed-system-2026-09-01.txt`, `design-lfg-system-2026-09-01.txt` | ROK-1450 epic (LFG), embed stories | ROK-1571/1572/1573 (LFG follow-ups) |
| 7 | **Find a better time, second round** — ROK-1587 (three overlays in one phone row: You outline, Suggested block, slot chips), ROK-1588 (desktop week-columns replacement for the painted heatmap, in the day-view language) | — | — | ROK-1587 + ROK-1588 (PR #1250) | — |
| 8 | **Funnel filter standard** (2026-09-23, v3) — desktop toolbar `FilterPanelTrigger` + inline `FilterPanel`; phone/tablet (<1024px) neutral Filters FAB + `BottomSheet`, badge = active filters; `/games` chip rows + genre sheet retire, Common Ground's bespoke card retires, Calendar's sidebar chip + modal retire; a page's create FAB + Filters FAB stack per §4.1 | https://claude.ai/artifact/3fhB1i3QCDmhJQRbYu8JTZ | `planning-artifacts/specs/ROK-1659.md` | ROK-1659 (`/games`, Common Ground) + ROK-1662 (Calendar) | — |

Rules that came out of these rounds (operator, 2026-09-16): prototype before actioning a design change;
only decisions ship (prune losing candidates from `web/src/dev/**`); a shared component (`JourneyHero`)
carries the same language on every mount, phone and desktop; iPads use the phone layouts.

