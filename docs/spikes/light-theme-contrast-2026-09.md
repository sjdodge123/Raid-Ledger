# ROK-1472 — Light-theme contrast audit (WCAG AA)

**Spike, 2026-09-19.** Static analysis only. No browser, no dev env (fourteen lanes were
sharing the machine). Every ratio below is **computed**, not eyeballed: token values parsed
out of `web/src/index.css` and the Tailwind v4 palette parsed out of
`node_modules/tailwindcss/theme.css` (oklch → sRGB), composited for alpha, then run through
the WCAG 2.x relative-luminance formula.

Thresholds used: **4.5:1** normal text, **3:1** large text (≥18.66px bold / ≥24px) and
non-text UI component boundaries (WCAG 1.4.11).

## 0. Scope — "the light theme" is six themes

`web/src/index.css:95` hands one shared override block to six schemes:

| scheme | `--color-surface` | `--color-backdrop` |
| --- | --- | --- |
| `light` | `#ffffff` | `#f8fafc` |
| `quest-log` | `#ffffff` | `#f8fafc` |
| `sky` | `#FFFFFF` | `#F0F4F8` |
| `holy` | `#FFFFFF` | `#F8F9FC` |
| `dawn` | `#FFF1E3` | `#FFF8F0` |
| `celestial` | `#EDE8DC` | `#F5F0E8` |

**All six were measured.** The nine dark schemes (`space`, `underwater`, `obsidian`, `ember`,
`arctic`, `bloodmoon`, `forest`, `fel`, and the `@theme` default) were **not** measured — this
story is light-theme scoped.

This split is itself finding **L-1**: the ROK-464 remap layer was tuned against white, but
`dawn` (`#FFF1E3`) and `celestial` (`#EDE8DC`) are 6–12% darker. Every accent ratio loses
~0.3–0.6 on `dawn` and ~0.5–0.9 on `celestial`, so a pairing that scrapes 4.5:1 on `light`
fails on the other two. **Any fix must be validated against `celestial`, the worst case, not
against `light`.**

Pairs measured: **120** token-on-token (5 text tokens × 4 surface tokens × 6 schemes) +
**306** accent-family pairs (51 foreground/background combinations × 6 schemes) = **426**.

## 1. Headline: the ROK-464 remap layer's own comments are wrong

`web/src/index.css:662-674` bumps dark-tuned `-400` accent text to `-600` for the light family
and annotates each line with a passing ratio. **Those annotations do not match the colours.**
Measured against `--color-surface` on `light`:

| rule (`index.css`) | remapped to | comment claims | **measured** | verdict |
| --- | --- | --- | --- | --- |
| `.text-amber-400` :663 | `#d97706` | 4.3:1 | **3.19:1** | FAIL |
| `.text-yellow-400` :664 | `#ca8a04` | 4.2:1 | **2.94:1** | FAIL |
| `.text-green-400` :666 | `#16a34a` | 4.5:1 | **3.30:1** | FAIL |
| `.text-emerald-400` :668 | `#059669` | 4.5:1 | **3.77:1** | FAIL |
| `.text-emerald-300` :669 | `#059669` | — | **3.77:1** | FAIL |
| `.text-cyan-300` :673 | `#0891b2` | 4.5:1 | **3.68:1** | FAIL |
| `.text-cyan-400` :674 | `#0891b2` | 4.5:1 | **3.68:1** | FAIL |
| `.text-red-400` :662 | `#dc2626` | 4.6:1 | 4.53:1 | pass (fails on `dawn` 4.36 / `celestial` 3.95) |
| `.text-yellow-500` :665 | `#a16207` | 5.2:1 | 5.15:1 | pass (`celestial` 4.03 FAIL) |
| `.text-emerald-500` :670 | `#047857` | 6.0:1 | 5.57:1 | pass (`celestial` 4.49 marginal) |
| `.text-purple-400` :671 | `#7c3aed` | 5.2:1 | 5.15:1 | pass |
| `.text-indigo-400` :672 | `#4f46e5` | 5.9:1 | 5.81:1 | pass |

The claimed numbers appear to have been copied from a table rather than computed. The
**`-600` tier of a warm or mid-luminance hue simply does not reach 4.5:1 on white** — it lands
at 2.9–3.8:1, which clears the 3:1 UI/large-text bar and nothing more. Only cool, dark hues
(red, indigo, violet) make it at `-600`.

**Root cause, one line:** the remap targets the wrong shade tier. `-700` is the first tier that
clears 4.5:1 across all six light schemes:

| hue | `-600` on white | `-700` on white | `-700` on `celestial` | `-700` on its own tint (`celestial`) |
| --- | --- | --- | --- | --- |
| amber | 3.20 | **5.03** | 4.11 | 4.33 |
| yellow | 2.94 | **4.93** | 4.03 | 4.32 |
| green | 3.22 | **4.95** | 4.05 | 4.27 |
| emerald | 3.65 | **5.36** | 4.39 | 4.50 |
| cyan | 3.62 | **5.28** | 4.32 | 4.50 |
| red | 4.77 | **6.42** | 5.25 | 5.26 |

Note the residual: even `-700` does not reach 4.5:1 on `celestial`/`dawn` for amber, yellow and
green. Those three hues need `-800` (5.8–6.4 on `celestial`) if `celestial` is to pass at the
normal-text bar, or the two warm schemes need their own lightened surface.

## 2. The reported bug, measured

The trigger was the LFG hearted-games prompt. `web/src/components/lineups/decided/LfgBridgePrompt.tsx:249`
is `bg-amber-500/10 border border-amber-500/30`; `:177` is `text-amber-400`; `:119` and `:133`
are `text-amber-400/70`.

Resolved through the remap layer, `bg-amber-500/10` becomes `rgba(254,243,199,0.5)` (amber-100
at half alpha) → composited tint **`#fff9e3`** on `light`. Against that tint:

| element | resolved colour | `light` | `dawn` | `celestial` |
| --- | --- | --- | --- | --- |
| `text-amber-400` (headline) | `#d97706` | **3.02** | **2.87** | **2.74** |
| `text-amber-400/80` | `rgba(217,119,6,0.85)` | **2.53** | **2.44** | **2.35** |
| `text-amber-400/70` (2nd line) | `rgba(217,119,6,0.75)` | **2.26** | **2.18** | **2.12** |
| `text-amber-400/60` | `rgba(217,119,6,0.65)` | **2.02** | **1.96** | **1.91** |

That is the operator's report reproduced numerically, including "the second line fainter
still". The opacity variants at `index.css:677-683` are the aggravating factor: they re-apply
alpha *on top of* an already-failing colour, and alpha over a light background only ever
reduces contrast.

## 3. Failures by family, ranked by reach

Usage counts are `grep` over `web/src/**/*.{ts,tsx}` excluding `web/src/dev/**` and tests.
"Remapped?" = has an entry in the ROK-464 light-family layer.

### F-1 — `text-amber-300` / `text-amber-200` on amber tint — **no remap at all** (72 uses)

`text-amber-300` (55) and `text-amber-200` (17) are **absent from the remap layer**, so they
render raw in all six light schemes: **1.45:1** and **1.24:1** on `light`, **1.18:1** and
**1.02:1** on `celestial`. Effectively invisible. Highest-severity family by a wide margin.

Confirmed instances (light-scheme reachable, not `.badge-overlay`):

- `web/src/components/lineups/LineupBanner.tsx:66` — `border-amber-500/40 bg-amber-500/10 text-amber-300`
- `web/src/components/lineups/LineupBanner.tsx:157` — `bg-panel text-amber-300 border-amber-500/40` — this is the **`Start another lineup` outline button** named in the story
- `web/src/components/pugs/pug-card.tsx:49` — `bg-amber-600/30 text-amber-300` Guest/Invite pill
- `web/src/components/features/game-time/EventBlockPopover.tsx:88` — `text-amber-300 bg-amber-500/10` Confirm button
- `web/src/components/admin/UserManagementRow.tsx:75` — `DEACTIVATED_TONE = 'bg-amber-500/15 text-amber-300 border-amber-400/30'`
- `web/src/components/admin/UserManagementRow.tsx:100` — `AMBER = 'text-amber-300 hover:bg-amber-500/10'`
- `web/src/components/admin/onboarding/secure-account-step.tsx:56` — `bg-amber-500/10 text-amber-300` `<code>`

`web/src/plugins/wow/components/talent-display.tsx:85,104` pairs `text-amber-300` with
`bg-amber-950/40` — the `-950` tint has **no light remap either**, so it stays near-black and
this pair is one of the few that is accidentally fine. It is fine for the wrong reason.

### F-2 — remapped `-400` text on its own tint (≈300+ uses)

`text-emerald-400` (168), `text-red-400` (154), `text-amber-400` (108), `text-yellow-400` (20),
`text-green-400` (16), `text-cyan-400` (5). All remapped, all landing 2.7–4.4:1 on tint:

| pair | `light` | `dawn` | `celestial` |
| --- | --- | --- | --- |
| `text-amber-400` on `bg-amber-500/10` | 3.02 | 2.87 | 2.74 |
| `text-amber-400` on `bg-amber-500/15` | 2.99 | 2.86 | 2.76 |
| `text-yellow-400` on `bg-yellow-500/10` | 2.83 | 2.69 | 2.58 |
| `text-yellow-400` on `bg-yellow-500/20` | 2.80 | 2.70 | 2.59 |
| `text-green-400` on `bg-green-500/10` | 3.16 | 2.99 | 2.85 |
| `text-emerald-400` on `bg-emerald-500/10` | 3.58 | 3.37 | 3.17 |
| `text-emerald-400` on `bg-emerald-500/20` | 3.49 | 3.33 | 3.22 |
| `text-cyan-400` on `bg-cyan-500/15` | 3.49 | 3.31 | 3.14 |
| `text-cyan-400` on `bg-cyan-500/20` | 3.43 | 3.28 | 3.17 |
| `text-red-400` on `bg-red-500/10` | 4.39 | 4.17 | 3.95 |
| `text-red-400` on `bg-red-500/20` | 4.21 | 4.08 | 3.96 |

Every row fails 4.5:1. Every row clears 3:1 on `light` except the yellows — so these are
*legible-but-non-compliant* for body copy, and compliant only where the text is genuinely
large. `text-emerald-300` (116 uses) is remapped to the same `#059669` as `-400`, so it shares
the `-400` row.

### F-3 — hues with **no light remap whatsoever** (≈90 uses)

`blue`, `sky`, `orange`, `rose`, `pink`, `violet`, `teal`, `fuchsia`, `lime` and the
`-300`/`-200` tier of every hue never appear in the ROK-464 layer. They render at their raw
dark-theme value on a light surface:

| class | uses | `light` | `celestial` |
| --- | --- | --- | --- |
| `text-blue-400` | 40 | 2.64 | 2.16 |
| `text-red-300` | 33 | 1.92 | 1.57 |
| `text-blue-300` | 17 | 1.81 | 1.48 |
| `text-indigo-300` | 9 | 2.01 | 1.64 |
| `text-rose-400` | 6 | 2.86 | 2.34 |
| `text-purple-300` | 5 | 1.78 | 1.46 |
| `text-orange-400` | 5 | 2.38 | 1.94 |
| `text-emerald-200` | 5 | 1.28 | 1.05 |
| `text-red-200` | 5 | 1.45 | 1.19 |
| `text-yellow-300` | 4 | 1.33 | 1.09 |
| `text-violet-300` | 4 | 1.86 | 1.52 |
| `text-violet-400` | 3 | 2.85 | 2.33 |
| `text-cyan-200` | 3 | 1.24 | 1.02 |

`text-blue-400` is the notable one: 40 uses, several of them **links** (`target="_blank"` rows
in the WoW/AI plugin cards), where 2.64:1 is both a contrast failure and a link-affordance one.
`web/src/plugins/wow/components/character-preview-card.tsx` uses `text-blue-400` as the
Alliance faction colour — a semantic that cannot simply be darkened without a design call.

### F-4 — neutral tokens: `text-dim` and `text-faint`

Token-level, independent of Tailwind. `text-faint` fails catastrophically in every light
scheme (1.20–1.87:1) and `text-dim` fails in four of six:

| scheme | `text-dim` on `surface` | on `panel` | on `overlay` | `text-faint` on `surface` |
| --- | --- | --- | --- | --- |
| `light` / `quest-log` | 4.76 | **4.34** | **3.86** | **1.48** |
| `sky` | **2.94** | **2.56** | **2.35** | **1.51** |
| `holy` | **3.51** | **3.13** | **2.81** | **1.51** |
| `dawn` | **3.10** | **2.90** | **2.62** | **1.43** |
| `celestial` | **3.48** | **3.15** | **2.78** | **1.73** |

`--color-faint` is documented as dual-purpose ("text & bg", `index.css:41`) and in the light
block is set to `#cbd5e1` — a *background* value. Any `text-faint` in a light scheme is a
guaranteed failure. `--color-dim` is the `placeholder-dim` token, so **placeholder text fails
AA in `sky`, `holy`, `dawn` and `celestial`** and is marginal in `light`/`quest-log`.

`text-muted` passes everywhere except `celestial` on `bg-overlay` (4.45, marginal).
`text-secondary` and `text-foreground` pass everywhere with room.

### F-5 — non-text UI boundaries (3:1)

Informational, and **not all of these are violations** — WCAG 1.4.11 only covers boundaries
*required to identify* a control, so decorative card edges are exempt. The numbers on `light`:

- `--color-edge` `#cbd5e1` on `surface`: **1.48:1**
- `--color-edge-strong` `#94a3b8` on `surface`: **2.56:1**
- the remapped `.border-amber-500/30` → `rgba(252,211,77,0.5)` on `surface`: **1.21:1**

Where these are input-field borders, segmented-control edges or the *only* indicator of a
toggle's state, they fail. Where they are card outlines, they do not. **Resolving which is
which needs the browser** — see §5.

## 4. Recommended fix families (not yet implemented)

Ordered by reach ÷ cost. All are token/layer changes, no component sweep.

1. **Retarget the ROK-464 remap from `-600` to `-700`** (`index.css:662-674`). One edit per
   line, covers ≈300 call sites. Gets `light`/`quest-log`/`sky`/`holy` fully compliant.
2. **Add the missing `-300`/`-200` entries** to the same layer, mapping them to the same
   `-700` value as their `-400` sibling. Closes F-1 (72 uses) without touching a component.
3. **Add the missing hues** — `blue`, `sky`, `orange`, `rose`, `pink`, `violet`, `teal`,
   `fuchsia`, `lime`. Closes F-3 (≈90 uses).
4. **Delete the opacity variants** at `index.css:677-683` rather than re-tuning them. Alpha on
   a light background can only subtract contrast; a `/70` variant of an AA-compliant colour is
   never AA-compliant. Map them to the solid `-700` value.
5. **`--color-faint` must not be used as text in light schemes.** Either split the token
   (`--color-faint` bg / `--color-faint-text`) or add a lint/guard banning `text-faint` +
   `placeholder-dim`. Raising `--color-dim` to ≈`#5a6b7f`-equivalent per scheme fixes
   placeholders.
6. **`dawn` and `celestial` need their own pass.** Their surfaces are dark enough that even
   `-700` misses 4.5:1 for amber/yellow/green. Either give those two schemes an `-800` tier, or
   lighten their `--color-surface`. This is a design call, not a mechanical one.

Sequencing note: 1–4 are a single contiguous edit to one CSS block. That block is **not** a
`docs/**` or `web/src/dev/**` file, so making it takes the branch out of spike tier and onto
the full review path.

## 5. What static analysis could NOT assess

Honest list; each needs a browser and is why the story's Playwright/axe half still stands.

- **Which borders are load-bearing.** §F-5 needs the rendered DOM to separate a decorative card
  edge from an input outline.
- **Text over cover images.** `game-badges.tsx:126` already carries a measured `1.02:1` note for
  `bg-amber-300/20 text-amber-300` over a bright cover. Cover art is arbitrary; only a
  screenshot sampler can judge it. The `.badge-overlay` escape hatch (`index.css:750-762`,
  4 call sites) deliberately restores dark-theme colours there and was excluded from §3.
- **Focus rings.** Not measured — ring colour resolution depends on the rendered `ring-*`
  utility and the adjacent background.
- **Disabled states.** `disabled:opacity-60` and friends multiply against whatever the resolved
  colour is; I did not enumerate them.
- **Actual composite stacks.** I composited tint-over-`surface`. Real markup nests tint over
  `panel` over `surface`, and a parent's background is frequently on a different element than
  the text. My §3 pairs are the ones that co-occur in a single `className`; a parent-child
  split pair would be missed.
- **Charts, heatmaps, the game-time grid.** `--gt-*` inline-style tokens and the
  `strip-bar-split` gradient are data-driven; not measured.
- **Whether a failing string is large text.** Several §F-2 rows clear 3:1 and would pass as
  large text. I did not resolve font sizes.

## 6. Reproducing

The measurement script is not committed (throwaway). It does: parse `--color-*` from
`node_modules/tailwindcss/theme.css` (oklch → Oklab → linear sRGB → gamma), parse the scheme
blocks and the ROK-464 remap rules out of `web/src/index.css`, resolve each utility class
through remap-then-token-then-palette, alpha-composite over the scheme's `--color-surface`,
and apply WCAG 2.x relative luminance. Spot-check: Tailwind v4 `amber-500`
`oklch(76.9% 0.188 70.08)` → `#fe9a00`, **2.13:1** on white.
