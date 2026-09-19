# ROK-1159 — image loading audit (lane handover)

Branch `perf/rok-1159`, 4 commits off `origin/main`. **Not pushed, no PR.**

## New pattern

**None.** `docs/design-system.md` already names `game-card-parts.tsx::CoverImage`
as the sanctioned cover primitive (inventory line 200, DO/DON'T line 238), so the
hygiene attributes were added *to it* rather than to a new `<GameCover>`. The
story's "extract a `<GameCover>` if 3+ duplications" clause is satisfied by the
component that already exists — introducing a second one would have been the
exact parallel-primitive failure the design system warns about.

One new **lib** module, not a UI pattern: `web/src/lib/igdb-image.ts`.

## Does the CDN support size variants? (story asked — answer is split)

- **IGDB: yes.** The rendition is a path segment —
  `https://images.igdb.com/igdb/image/upload/t_cover_big/<hash>.jpg`. Rewriting
  `t_cover_big` → `t_cover_small` (90w) / `t_cover_big_2x` (528w) yields a real
  responsive set. The API stores the `t_cover_big` form
  (`api/src/igdb/igdb.constants.ts:81`), so every IGDB cover is rewritable.
- **ITAD boxart: no.** `api/src/steam/steam-itad-discovery.helpers.ts:54` falls
  back to `itadGame.assets.boxart`, whose host has no documented rendition API.
  There is no token to rewrite and a guessed one 404s.

So `coverSrcSet()` returns `null` for non-IGDB URLs and callers spread `{}` —
**no `srcSet` attribute is emitted at all** rather than shipping a set that
resolves to broken images. This is the one assertion in the test file worth
keeping if anything else is cut.

## Inventory (scripted, excludes test files)

| | before | after |
|---|---|---|
| `<img>` elements in `web/src` | 102 | 103 |
| with `loading=` | 10 | 25 |
| with intrinsic `width`+`height` | **0** | 17 |
| with `decoding=` | 0 | 17 |
| with `srcset` | 0 | 15 |

## Fixed (17 sites / 13 files)

`CoverImage` (shared — flows to `UnifiedGameCard`, `DrawerCard`,
`CommonGroundGameCard`, `unified-game-card-parts`), `NominationCard`,
`poll-game-search` ×2, `game-search-input` ×2, `VotingRow`, `GameRef`,
`game-row-pill`, `event-card` ×2, `mobile-event-card`, `ScheduleView`,
`CarriedForwardSection`, `AiSuggestionCard`, `NominateModal` ×2.

Each got: intrinsic `width`/`height` (the CSS box for fixed thumbs, the IGDB
264×374 cover ratio for full-bleed), `loading="lazy"`, `decoding="async"`, and
`srcSet`/`sizes` where the URL is a rewritable IGDB one. CSS still governs the
painted size — the attributes only supply the aspect ratio, so there is no
intended visual change.

`CoverImage` also gained a `priority` prop (`loading="eager"` +
`fetchPriority="high"`) for a known-LCP hero. **It is not yet used anywhere** —
see below.

## Deliberately left (86 sites) — and why

1. **Discord-CDN avatars — 37.** Mostly ≤48px, already served at a requested
   `?size=`. Low CLS (fixed round boxes) and no rendition rewrite to gain.
   Worth a follow-up pass for `width`/`height` only; no srcset value.
2. **Other cover-art/banner sites — ~20**, incl. `LineupBanner:98`,
   `LfgBridgePrompt:97`, `SchedulingGameRefBanner:49`,
   `standalone-poll-banner:17`, `SchedulingBanner:17`, `GameLibraryTable:25`,
   `CohortFrequencyPanel:153`. These are singletons (one banner per page), so
   they carry a fraction of the bytes of the list surfaces above. **This is the
   highest-value remaining group** — same one-line treatment.
3. **WoW plugin icons — 8.** Plugin-owned surface, fixed tiny sizes.
4. **Community logo / branding — 8.** One per page, above the fold; lazy would
   *hurt*. Needs `width`/`height` only, and the uploaded-asset path has no CDN.
5. **Misc icons / emoji / role badges — 10.** ≤24px, inline-flow, negligible.
6. **Screenshots / stream thumbs — 3.** `ScreenshotGallery` and
   `TwitchStreamEmbed` are already `loading="lazy"`; they need dims, and
   screenshots use a *different* IGDB rendition (`t_screenshot_big`) that this
   helper's cover widths would mis-describe. Don't reuse `coverSrcSet` there.
7. **CSS `background-image` covers — 6** (`DayEventCard:148`, `WeekEventCard:71`,
   `MonthEventComponent:15`, `GameTimeWidget:116`, `EventBanner:107`). Not
   `<img>`, so `loading`/`srcset`/dims do not apply. ROK-1482 already warms these
   via `lib/image-hints.ts` preconnect + prefetch. Converting them to `<img>` is
   a real refactor with layout risk — **out of scope, worth its own story.**

## Not done

- **Lighthouse before/after (story acceptance criterion).** Requires a deployed
  env; this lane has no fleet tools and did not deploy. **Whoever picks this up
  must capture `/games`, lineup detail and game detail mobile LCP** — the story
  cannot close without it.
- **`fetchPriority="high"` on the LCP image.** The prop exists on `CoverImage`
  but no caller passes it, because identifying the true LCP element on the game
  detail page needs the Lighthouse run above. Wiring it blind would be a guess.
- **No Playwright spec added.** Every change is a pure attribute addition with no
  rendered-flow change (verified by 173 existing component tests passing
  unchanged), which `CLAUDE.md` classes as behavior-neutral. Covered by unit
  assertions instead.

## Red

**Nothing.** No pre-existing failures encountered, so no `TECH-DEBT-BACKLOG.md`
entry was needed.

## Verification actually run

- `npx vitest run --root web src/lib/igdb-image.test.ts` — **13 passed**
- `npx vitest run --root web src/components/games/game-card-parts.test.tsx` — **36 passed**
- 7 `CoverImage` consumer specs (unified-game-card ×3, DrawerCard,
  card-surface-parity, game-card-integration, CommonGroundGameCard) — **120 passed**
- 12 specs covering the touched components — **173 passed**
- `npm run build -w web` — clean (tsc + vite)
- `npx eslint` on all 14 touched files — **0 errors, 14 warnings = exact base
  parity** (measured against `origin/main`; one new `max-lines-per-function`
  warning was introduced and then removed by extracting `CoverArt` in
  `event-card.tsx`)

**Not run:** full suite (fleet-only), Playwright, `validate-ci.sh`, Lighthouse.
Light/dark verification was not done in a browser — no env was deployed — but
no colour token or class was added or changed anywhere in the diff.
