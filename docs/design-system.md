# Raid Ledger — Design System Reference

**Audience: agents about to add or change UI.** Everything below is derived from what
ships in `web/src` today (read the cited files; they are the source of truth, this doc
is the index). Nothing here is aspirational.

**Why this file exists (operator, 2026-09-13):** "A lot of new features end up doing
something drastically different and it leaves users confused." Canonical example: `/games`
filters with the shared `FilterPanel` (funnel, count badge, "Filters / Clear all", mobile
sheet); the lineup's Common Ground panel is a bespoke card with none of it. Same job, two
designs, because nothing told the second author the first existed.

---

## 1. Before adding UI — checklist

1. **Find the primitive.** Search §3 below, then `web/src/components/ui/`, then the
   de-facto shared list. If something with that job exists, use it.
2. **Match the pattern.** §4 gives the DO for each recurring job. Copy the DO, not the
   nearest file you happened to open.
3. **Check for an approved design target** before you draw your own — see
   `CLAUDE.md` → "Reference designs before coding". Existing targets:
   - `docs/spikes/rok-1193-lineup-ux-audit.md` (lineup UX audit)
   - `/dev/wireframes/simplify` — Cycle 4 "Unify" (`web/src/dev/simplify-wireframes/`)
   - `/dev/wireframes/lineup` — lineup page wireframes (`web/src/dev/lineup-wireframes/`)
   - `/dev/wireframes/binding-admin` (`web/src/dev/binding-admin-wireframes/`)
   - `/dev/design-system` — this document, rendered (`web/src/dev/design-system/`)
4. **Use tokens, never raw slate.** `bg-panel`, not `bg-slate-800`. Fifteen themes
   remap the tokens; a hardcoded slate breaks in all of them.
5. **If no primitive fits, say so out loud.** Put a line in the PR description:
   `New pattern: <what> — <why nothing existing fits>`. Silent invention is the failure
   mode this doc exists to stop.
6. **Verify in `default-dark` AND `default-light`, plus one per-scheme-override light
   theme (`sky`), before calling UI done.** Half the themes are light; a dark-only check
   ships a contrast bug to every one of them. `/dev/design-system` has a scheme switcher
   and a side-by-side toggle for exactly this.
7. **New tokens go into the shared light block AND the four per-scheme light blocks.**
   `index.css:75` (shared, `:is(light, quest-log, sky, dawn, holy, celestial)`), then
   `:158` (`sky`), `:210` (`dawn`), `:262` (`holy`), `:314` (`celestial`) — those four
   re-declare the same token set, so a token added only to the shared block is unthemed
   in them. The dark defaults live on `@theme` (`:32`) and `html` (`:65`) — the root
   only, which is §6.8.

---

## 2. Tokens

### 2.1 Colour roles

Declared in `web/src/index.css` (`@theme` block, line 32) as `--color-*`. Tailwind v4
generates the utility from the variable name: `--color-panel` → `bg-panel`,
`text-panel`, `border-panel`. Borders have their own roles.

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

**Themes.** `data-scheme` on `<html>` swaps every value — except `quest-log`, which is
applied via `data-variant` (`web/src/stores/theme-helpers.ts:53,76-82`; the token block
is `index.css:1157`),
so `data-scheme` is not the whole mechanism. Light family (one shared override block at
`index.css:75`, **plus** per-scheme blocks that re-override the same tokens for `sky`
(`index.css:158`), `dawn` (`:210`), `holy` (`:262`) and `celestial` (`:314`) — a token
added only to the shared block leaves those four unthemed): `default-light`, `quest-log`,
`sky`, `dawn`, `holy`, `celestial`. Dark family (each its own): `default-dark`, `space`,
`underwater`, `obsidian`, `ember`, `arctic`, `bloodmoon`, `forest`, `fel`. That is
fifteen schemes in total (`web/src/stores/theme-registry.ts`). Every colour you add must
be a token or a §2.2 accent hue — a raw hex is a bug in 14 of the 15 themes.

**The two families are not symmetric.** Light schemes declare their tokens on
*unqualified* `[data-scheme=...]` selectors, so they also apply to a nested
`<div data-scheme="sky">`; the dark values live on `@theme` (`:32`) and `html` (`:65`)
with no `[data-scheme="dark"]` block, so a scoped dark wrapper inherits whatever the root
is (§6.8). `color-scheme` (`:576-590`), the page background (`body` `:592`, `#root`
`:599`) and quest-log's parchment (`:1228`, `:1241`) are root-only either way — full list
in `docs/design-system-tokens.md` §4.

### 2.2 Accent hues (raw Tailwind, deliberate)

Semantic accents are NOT tokenised — they are Tailwind palette colours used by
convention, with per-theme contrast fixes in `index.css` (light-family overrides from
~line 640, plus a `.badge-overlay` scope for badges over imagery). Measured `bg-*` use
in `web/src/components` (reproduce with
`grep -rhoE "bg-<hue>-[0-9]+" web/src/components --include='*.ts' --include='*.tsx' | wc -l`,
excluding `*.test.tsx`):

| Hue | Count | Means |
|---|---|---|
| `emerald` | 280 | Primary action, success, "on"/active, brand |
| `red` | 104 | Danger, destructive, BEFORE/wrong in wireframes |
| `amber` | 92 | Warning, admin, and the **chip-on** state (`bg-amber-500/10 border-amber-500/30 text-amber-300`) |
| `blue` / `indigo` | 58 / 22 | Secondary CTA, informational |
| `cyan`, `purple`, `yellow`, `green` | ≤14 each | One-off categorical accents — do not add more |

Alpha-on-token is the house style for tinted surfaces: `bg-emerald-500/10` over
`bg-panel`, border `border-emerald-500/30`. Solid fills (`bg-emerald-600`) are for
buttons only.

**Dark shade vs light shade.** You write ONE class and `index.css` repaints it for the
six light schemes: text `-400` → `-600`/`-700` (`:640-652`), tinted fills → a `-100` wash
(`:672-694`), borders → a `-300` (`:708-720`). Solid button fills are identical in both
families, with the label forced white on light (`:744-750`). Two shades were never given
an override and are unreadable on light — `text-amber-300` (≈1.4:1, and it is the chip-ON
label) and `text-blue-400` (≈2.5:1); see §6.9. Badges over cover art opt OUT of the light
bumps with `.badge-overlay` (`:729-741`).

> **Full shade-pair table:** `docs/design-system-tokens.md` §1 — or `/dev/design-system`
> → *Accent hues*, where every row paints in the class it documents and the "Side by
> side" toggle shows both families at once.

### 2.3 Game-time widget tokens

`--gt-widget-bg`, `--gt-widget-border`, `--gt-split-bg`, `--gt-past-highlight`,
`--gt-hover-glow`, `--gt-proximity-line`. Declared on `html` (~line 60), re-declared per
theme. They exist because the game-time grid paints via **inline styles** computed per
cell, where Tailwind classes cannot reach. Dark defaults: `rgba(30,41,59,.7)` /
`rgba(51,65,85,.6)` / `rgba(30,41,59,.8)` / `rgba(30,41,59,.3)` / `rgba(148,163,184,.2)`
/ `148, 163, 184` (a bare RGB triple, used as `rgb(var(--gt-proximity-line) / <a>)`).
Game-time grid only.

### 2.4 Type scale

Fonts: `Inter` body (set on `body`, line 596), `.font-display` → `Cinzel`
(`index.css:604`), plus `MedievalSharp` / `Uncial Antiqua` inside the quest-log theme
only. Loaded from Google Fonts at the top of `index.css`.

Measured frequency in `web/src/components`, with the page-level scale beside it:

| Class | In components | Used for |
|---|---|---|
| `text-sm` | 636 | **Default.** Body, labels, buttons, list rows |
| `text-xs` | 408 | Hints, metadata, badges, captions |
| `text-lg` | 54 | Section / modal headings |
| `text-base` | 22 | Mobile form inputs only (prevents iOS Safari zoom on focus) |
| `text-xl` | 21 | Sub-page and card-group titles (43 uses in `pages/`) |
| `text-2xl` | 17 | Hero numbers (11 in `pages/`) |
| `text-3xl` | 0 | **Page `<h1>` only** — 14 uses, all in `web/src/pages/` |

Weights: `font-medium` (364) for labels and chips, `font-semibold` (213) for headings,
`font-bold` (48) for page titles, badge counts and emphasis, `font-mono` (8) for numeric
readouts next to a slider. There is no `font-light`.

### 2.5 Spacing, radius, elevation

- **Gap ladder:** `gap-2` (251) is default, `gap-3` (145) for looser rows, `gap-1` /
  `gap-1.5` inside chips and badges, `gap-4` / `gap-6` between sections. Padding follows:
  `p-3`/`p-4` for cards, `px-3 py-2` for inputs and buttons, `px-2 py-0.5` for pills.
- **Radius:** `rounded-lg` (394) is the default for cards, panels, inputs and buttons.
  `rounded-full` (192) for chips, pills, avatars and count badges. `rounded-xl` (61) for
  hero/large surfaces. `rounded-md` (57) for small inputs. Avoid `rounded-2xl` (1 use).
- **Elevation** is border + tint, not shadow. `.glass-card` (`index.css:610`) is the one
  blurred surface; `.glow-emerald` / `.glow-indigo` (`index.css:778,786`; vars at `:438-439`) glow a
  primary action. Themes
  restyle these — never reimplement them inline.
  - **Light / Dark:** dark separates with borders and the surface step and adds no
    shadow; the light family adds the shadow it needs (`.bg-panel` `:753-757`,
    `.glass-card` `:622-630`). Use `bg-panel` / `.glass-card` and you get both; a
    hand-rolled `shadow-lg` adapts to neither. Detail:
    `docs/design-system-tokens.md` §2.
- **Tap targets:** `min-h-[44px]` on anything touchable (WCAG 2.5.5 / Apple HIG);
  `CommonGroundFilters.tsx:38-42` carries the rationale.

### 2.6 Motion

- `transition-colors` (348) is the default and covers hover/active states.
  `transition-all` (45) only where size or position also moves, `transition-transform`
  (15), `transition-opacity` (11).
- Springs are named CSS variables: `--spring-smooth` and `--spring-bounce` — a
  cubic-bezier fallback on `:root` at `index.css:449-452`, upgraded to `linear()` easing
  inside `@supports (transition-timing-function: linear(0, 1))` at `:456-469`. Debugging
  motion in an older browser, you are looking at the fallback. `@keyframes modal-spring` (473) and
  `drawer-slide` (486) are the entrance animations for `Modal` and `BottomSheet`.
- A global rule scales `button:active, a:active, [role="button"]:active` to `0.97` — you
  get press feedback for free; do not add your own.
- `@media (prefers-reduced-motion: reduce)` flattens every spring and animation. Any new
  animation must survive that block being applied.

### 2.7 Theme particles

`components/ui/ThemeParticles.tsx` + `theme-particles.{config,effects,helpers,tick}.ts`
— canvas ambient particles and per-theme background effects (`aurora` arctic, `lava`
ember, `sun` forest — `theme-particles.config.ts:78-83`; `dawn` has no `CONFIGS` entry). `pointer-events: none`, respects reduced motion, height-capped to
document content. Mounted once at app level — never a second instance.

---

## 3. Component inventory

### 3.1 `web/src/components/ui/` — the shared primitives

| Component | What it is | Use when | Key props |
|---|---|---|---|
| `filter-panel.tsx` → `FilterPanel`, `FilterPanelTrigger` | **The** filtering primitive. Desktop: collapsible bordered panel with "Filters" + "Clear all". Mobile (<768px): `BottomSheet`. Trigger is a funnel icon with an emerald count badge. | Any list/grid filtering, anywhere | `activeFilterCount`, `onClearAll`, `isOpen`, `onToggle`, `children`; trigger: `resultCount`, `hasActiveFilters`, `onClick` |
| `bottom-sheet.tsx` → `BottomSheet` | Mobile drawer from the bottom, drag-to-dismiss | Mobile equivalent of a modal or panel | `isOpen`, `onClose`, `title`, `maxHeight` (default `60vh`) |
| `modal.tsx` → `Modal` | Portalled dialog, focus trap + ARIA (ROK-342) | Desktop dialogs, confirmations | `isOpen`, `onClose`, `title`, `maxWidth` (default `max-w-md`), `bodyClassName`, `initialFocusRef` |
| `modal-helpers.tsx` → `ModalSearchInput`, `ModalEmptyState`, `ModalListBody` | Search + empty + list body inside a modal | Any searchable picker modal | see file |
| `fab.tsx` → `FAB` | Floating action button | One primary create action per mobile page | `onClick`, `icon` (default `PlusIcon`), `label` |
| `nav-chip.tsx` → `NavChip`, `NAV_CHIP_CLASS` | Navigational link chip | Linking to a sibling lineup/page from a banner | `to`, `children`, `testId` |
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
| `Layout.tsx`, `Header.tsx`, `Footer.tsx`, `bottom-tab-bar.tsx`, `mobile-page-toolbar.tsx`, `more-drawer.tsx`, `live-region-provider.tsx` | `components/layout/` | App chrome. `live-region-provider` is the a11y announcer — use it, don't `alert()`. |
| `AvatarWithFallback.tsx`, `RoleIcon.tsx`, `journey-hero/`, `submit-bar/` | `components/shared/` | Avatars, role glyphs, the journey hero and the sticky submit bar |
| `LineupEmptyState.tsx` | `components/lineups/` | The empty-state shape (see §4.5) |
| `player-filters.tsx`, `pages/games/coop-filter-controls.tsx` | filter bodies | Reference implementations of `FilterPanel` children |

Toasts come from **`sonner`** — `<Toaster>` is mounted in `web/src/App.tsx:105`; call
`toast.success(...)` / `toast.error(...)` from `sonner` directly.

---

## 4. Pattern rules

### 4.1 Filtering — `FilterPanel` is canonical

**DO** — `web/src/pages/games/coop-filter-section.tsx` and
`web/src/pages/players-page.tsx:87-93`: a `FilterPanelTrigger` (funnel + result-count
badge) sits in the page toolbar; `FilterPanel` holds the controls and owns
"Filters" + "Clear all"; on mobile it becomes a `BottomSheet` for free. Escape closes the
desktop panel where the consumer wires it — `useEscapeToClose` is a local function in
`pages/games/coop-filter-section.tsx:30,51`, not a `FilterPanel` affordance; `players-page.tsx`
does not have it. When a predicate drops rows with NULL data, disclose
it in a hint line (`CoopFilterHint`) instead of letting the grid silently empty.

**DON'T** — `web/src/components/lineups/CommonGroundFilters.tsx`: a bespoke
`grid grid-cols-1 sm:grid-cols-2 lg:...` of always-visible controls. No funnel, no count
badge, no "Clear all", no mobile sheet, no collapse. Every one of those affordances
exists three files away. It is the counter-example this document was written for; see
§6.

**Light / Dark** — panel and sheet are tokens and follow the family; the emerald count
badge is a solid accent and is identical in both (`design-system-tokens.md` §3).

### 4.2 Cards

**DO** — compose from `game-card-parts.tsx`: `CoverImage` → `GradientOverlay` →
`CardTitle` → badges from `game-badges.tsx`. Card surface is
`bg-surface border border-edge rounded-lg`; hover raises to `hover:bg-overlay` or a
border change, via `transition-colors`.

**DON'T** hand-roll a cover + title + rating stack per feature.
`card-surface-parity.test.tsx` exists because surfaces drifted before: one shared
component does not guarantee identical surfaces — check them side by side.

**Light / Dark** — the frame is tokens and flips; the artwork does not. `GradientOverlay`
stays dark on purpose (it makes white titles legible over the *image*), and anything
layered on the art needs `.badge-overlay` so the light bumps are suppressed there
(`design-system-tokens.md` §3).

### 4.3 Chips and pills

**DO** — the chip geometry is fixed:
`inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors`,
ON = `bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20`,
OFF = `bg-panel border border-edge text-secondary hover:bg-overlay`. Rendered as
`<button type="button">` with `aria-pressed`. See
`web/src/pages/games/library-filter-chips.tsx` and `lfg-filter-chip.tsx`.

**DON'T** write a fourth copy of those class strings. Both files carry an explicit note
that a **fifth** chip means promoting them to a shared module — if you are that fifth
chip, do the promotion. For navigation use `NavChip` / `NAV_CHIP_CLASS`, never a
hand-written `<Link>` with a pill className.

**Light / Dark** — OFF is tokens and flips cleanly. ON is three raw amber classes and
only the fill (`:677`) and border (`:713`) are remapped: `text-amber-300` has no light
override, so **the ON label is ≈1.4:1 — unreadable in all six light themes** (§6.9). A new
ON-state label should use `text-amber-400` until that is fixed.

### 4.4 Modal vs bottom sheet

**DO** — pick by viewport, not by taste: `useMediaQuery('(min-width: 768px)')` → `Modal`
on desktop, `BottomSheet` below. `FilterPanel` already does this internally; copy its
branch (`filter-panel.tsx:50-59`) when you need the same split elsewhere.

**DON'T** render a desktop `Modal` on mobile and rely on scrolling, or build a custom
overlay — `Modal` carries the focus trap and ARIA dialog semantics you would otherwise
have to re-earn.

**Light / Dark** — the body is tokens; the scrim is a raw black alpha with no light
override, so it dims identically in both (`modal.tsx:68`, `bottom-sheet.tsx:105`). Do not
invent a third alpha — the two that exist already disagree (§6.11).

### 4.5 Empty states

**DO** — centred, quiet, one sentence that says what to do next:
`<div className="text-center py-12"><p className="text-muted text-sm">No nominations yet.
Be the first to nominate a game!</p></div>` (`LineupEmptyState.tsx`); inside a modal,
`ModalEmptyState`. **DON'T** render a full-bleed illustration, a bordered card, or a bare
"No results" with no next step.

### 4.6 Loading

**DO** — `LoadingSpinner` for route-level `Suspense`; inside a component keep the frame
and grey the content instead of swapping in a spinner; `return null` while a gate query
resolves (what the dev wireframe routes do). **DON'T** flash a spinner for a sub-second
query, or unmount the page header while the body loads (layout jump on mobile).

### 4.7 Banners

**DO** — one banner at a time, and prefer the shared through-line: `HeroNextStep`
(`components/common/HeroNextStep.tsx`) is the "NEXT: …" affordance. App-level banners
(`ConnectivityBanner`, `DiscordJoinBanner`) live in the layout and are dismissible where
they are not blocking. Tint = `bg-<hue>-500/10 border border-<hue>-500/30`.

**DON'T** stack per-phase banners. `/dev/wireframes/simplify` §U1 documents exactly this
failure ("Same job · 4 different shapes") as the thing Cycle 4 removes.

**Light / Dark** — the `-500/10` + `-500/30` pair is remapped for light, but only for
`red`, `amber`, `emerald`, `green`, `yellow`, `indigo`, `cyan` (`:672-694`). A `blue` or
`purple` banner gets no light treatment at all. Keep body copy in `text-foreground` /
`text-secondary` and the hue on the icon or heading (`design-system-tokens.md` §3).

### 4.8 Toasts

**DO** — `sonner`'s `toast.success` / `toast.error` for the result of an action the user
took; `CopyButton`'s `copyWithToast` is the reference. **DON'T** toast what the UI
already shows, or use a toast for an error the user must act on — that needs inline text
beside the control.

### 4.9 Page header and back navigation

**DO** — `pages/events/EventsPageHeader.tsx` is the reference shape:
`mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4` wrapper, an
`<h1 className="text-3xl font-bold text-foreground mb-2">`, a `text-muted` subtitle
under it, and the page's action buttons in the right-hand slot of the same row (they
stack under the title on mobile). Mobile back/tab affordances come from
`mobile-page-toolbar.tsx`. Dev and wireframe pages use the lighter
`border-b border-edge pb-3 mb-6` + `text-xl font-semibold` variant
(`SimplifyWireframesPage.tsx`) — that is the *section* header shape (§4.10), not the
page header.

**DON'T** put a bespoke back arrow on each page — mobile back lives in the toolbar, and
desktop navigates via `Header` / breadcrumb links.

### 4.10 Section titles

**DO** — `<h2 className="text-lg font-semibold text-foreground">` with an optional
`text-sm text-secondary` description, separated by `border-b border-edge pb-2 mb-4`.
See `web/src/dev/design-system/design-system-bits.tsx:8-24::Section`
(`SimplifyWireframesPage.tsx::Section` uses `text-sm text-emerald-300 font-mono` +
`text-xs text-secondary` for its delta/why pair — same shape, different emphasis).

**DON'T** use `font-display` (Cinzel) for functional section headings — it is for
brand/hero moments and the quest-log theme.

### 4.11 Forms, sliders, checkboxes

**DO** — inputs are
`min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground
placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500/50`
(`CommonGroundFilters.tsx::SearchBox` — the control styling there is right even though
its composition is the §4.1 DON'T). Note that `ModalSearchInput` instead uses
`focus:ring-accent`, which resolves to nothing — see §6.3. `text-base` on inputs is
deliberate: 16px stops iOS
Safari zooming on focus. Sliders: `flex-1 h-11 accent-emerald-500` with enlarged
webkit thumbs, a `font-mono` numeric readout to the right, and a `font-medium` label to
the left. Checkboxes: `w-5 h-5 accent-emerald-500` inside a `<label>` so the text is
part of the target.

**DON'T** use a number input where the family around it uses sliders — the operator
ruled on this (2026-08-20) so a filter group reads as one control family.

**Light / Dark** — the frame is tokens and flips. The house focus ring
(`focus:ring-2 focus:ring-emerald-500/50`) and `disabled:opacity-50` +
`disabled:cursor-not-allowed` are deliberately family-agnostic; `disabled:bg-emerald-800`
(12 uses) is not and goes dark-on-white. Native control chrome follows `color-scheme`,
which is root-only (`:576-590`) — check sliders and checkboxes at the root, not in the
scoped preview (`design-system-tokens.md` §3).

### 4.12 Badges with counts

**DO** — absolutely-positioned circle on the trigger:
`absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold
text-white bg-emerald-500 rounded-full` (`filter-panel.tsx::FilterBadge`). Inline count
pills use `px-2 py-0.5 text-xs rounded-full` with a tinted background.

**DON'T** show a zero-count badge — `FilterPanelTrigger` only renders it when
`hasActiveFilters`.

**Light / Dark** — a solid-fill badge is identical in both families by design; a tinted
count pill must use the `bg-<hue>-500/10` + `text-<hue>-400` pair to pick up the light
remap, plus `.badge-overlay` over cover art.

---

## 5. Rendered reference

`/dev/design-system` (DEMO_MODE only) renders the swatches, the primitives an agent
reaches for most in their default / hover / disabled / loading / empty states (it does not
mount `PluginBadge`, `InfiniteScrollSentinel`, `PullToRefresh`, `ConnectivityBanner`,
`DiscordJoinBanner` or `StartupGate` — the §3.1 inventory is the complete list), and the §4.1 DO-vs-DON'T side by
side. Source: `web/src/dev/design-system/`. Gating is the shared dev-route pattern —
`useSystemStatus()`, `null` while loading, `<Navigate to="/" replace />` when
`demoMode !== true`; registered in `lazy-routes.ts` + `app-routes.tsx::DevWireframeRoutes`.

---

## 6. Known divergences

Found while reading the code for this document. Each is a candidate unification story —
the Lead files them; do not fix them as scope creep.

1. **`CommonGroundFilters` vs `FilterPanel`** (`components/lineups/CommonGroundFilters.tsx`
   vs `components/ui/filter-panel.tsx`). The lineup nomination panel filters with a
   bespoke always-visible grid: no funnel trigger, no result-count badge, no "Clear all",
   no mobile bottom sheet, no collapse. `/games` and `/players` all use the shared panel.
   *Suggested:* move the four controls into `FilterPanel` children (mirroring
   `pages/games/coop-filter-controls.tsx`) and add a `FilterPanelTrigger` to the Common
   Ground toolbar; the auto-seed hook and co-op dormancy logic move across unchanged.

2. **Chip class strings duplicated across two files**
   (`pages/games/library-filter-chips.tsx` and `pages/games/lfg-filter-chip.tsx` both
   carry byte-identical `BASE_CLS` / `ON_CLS` / `OFF_CLS`; `library-filter-chips.tsx:14-16`
   carries a module comment saying a fifth chip should trigger extraction, `lfg-filter-chip.tsx`
   has no such note). *Suggested:* promote to
   `components/ui/filter-chip.tsx` alongside `NavChip` and import from both.

3. **`--color-accent` is referenced but never defined — dead styling in ~25 places
   across 12 files.** Use a grep that catches the utility classes, not just the literal
   variable: `grep -rnE -- "--color-accent|(ring|text|bg|border)-accent" web/src`. A plain
   `grep -rn -- "--color-accent" web/src` finds only the 6 inline `var()` hits and misses
   the other 19 — anyone "replacing every call site" from that command silently skips
   three quarters of them. The 12 files: inline
   `style={{ backgroundColor: 'var(--color-accent)' }}` in
   `components/feedback/FeedbackWidget.tsx:79` and
   `components/feedback/FeedbackDialog.tsx:66,67,102,123,135`; the Tailwind classes
   `ring-accent` (`components/ui/modal-helpers.tsx:8`), plus `text-accent`,
   `border-accent`, `bg-accent` and `bg-accent/20` in
   `components/profile/AvatarUploadZone.tsx`, `pages/admin/backup-panel-modals.tsx`,
   `pages/admin/cron-jobs-panel.tsx`, `pages/admin/logs-panel.tsx`,
   `pages/admin/backups-panel.tsx:93,114`, `pages/cron-jobs/CronJobModals.tsx:200,226`,
   `pages/cron-jobs/CronJobCard.tsx:117`, `pages/profile/identity-sections.tsx:91,95`
   and `pages/user-profile/activity-modal.tsx:83`. The most visible symptom is
   `CronJobModals.tsx:226` — `className="... bg-accent hover:bg-accent/80 ... text-white"`,
   a white-on-transparent submit button. The variable is declared in **no** CSS file — `@theme`
   in `index.css` defines only the twelve roles in §2.1, and Tailwind v4 here is
   CSS-first with no `tailwind.config.*`. So `bg-accent` and friends generate no rule at
   all, and the inline `var(--color-accent)` resolves to empty: the Feedback widget's
   button paints transparent. *Suggested:* add `--color-accent` to `@theme` (emerald,
   per §2.2) with per-theme overrides, or replace every call site with an explicit hue —
   plus a guard test so an undefined `--color-*` cannot ship again.

4. **Search input styling lives in three places** — `ModalSearchInput`
   (`components/ui/modal-helpers.tsx`: `bg-surface/50`, `rounded-lg`, `text-sm`),
   `CommonGroundFilters::SearchBox` (`bg-panel`, `rounded-md`, `text-base`,
   `min-h-[44px]`), and the Discover-tab search in `pages/games-page.tsx`. Same control,
   three geometries — and only one of them meets the 44px mobile target.
   *Suggested:* one `components/ui/search-input.tsx`, consumed by all three.

5. **Empty states are ad-hoc.** `LineupEmptyState` is one bespoke component for one
   surface; `ModalEmptyState` covers modals; other surfaces inline their own centred
   `<p>`. *Suggested:* a single `components/ui/empty-state.tsx` taking
   `{ title, action? }`, and retire the one-offs.

6. **`InviteeList` row vs `NavChip`.** `nav-chip.tsx`'s header documents that
   `InviteeList` was deliberately left out (it is an `<li>`, not a link). Recorded here so
   the next reviewer does not re-raise it — **this one is intentional, not a divergence
   to fix.**

7. **Semantic accents are untokenised.** `emerald` / `amber` / `red` carry fixed meanings
   (§2.2) but ship as raw Tailwind hues, so every theme needs per-hue contrast overrides
   in `index.css` (~lines 640-760). *Suggested:* add `--color-success` / `--color-warning`
   / `--color-danger` to `@theme` alongside the `--color-accent` fix in §6.3.
