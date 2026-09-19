# ROK-1612 — LFG composer card · lane handover

Branch `feat/rok-1612`, cut from `origin/main` @ `6d3e1e037`. Three commits, all green.

## Scope reality check

The story is AC1–AC9 plus a migration-backed opt-in, listener wiring and a companion-bot
smoke spec. That is several lanes' worth. This lane built **the whole decision layer** —
every pure, unit-testable piece of the flow — and stopped before the Discord wiring.
Nothing here is half-wired: the module has no consumers yet, so `main` is unaffected by
merging it and the next lane has a complete, tested surface to wire against.

## What shipped — `api/src/discord-bot/lfg-composer/`

| file | what it owns | ACs |
| --- | --- | --- |
| `lfg-composer.constants.ts` | every custom-id prefix, all card/modal/reply copy, heading builders | card copy rulings |
| `lfg-composer-state.helpers.ts` | the whole state machine, carried in custom ids; back-navigation targets | AC9 |
| `lfg-composer-search.helpers.ts` | pure four-outcome classifier | AC2 |
| `lfg-composer-search.db-helpers.ts` | the two reads (shared word filter, then trigram) | AC2 |
| `lfg-composer-card.helpers.ts` | the pinned card + the prefilled modal | card, AC8 |
| `lfg-composer-urgency.helpers.ts` | the urgency row, ordered by horizon | AC3 |
| `lfg-composer-reply.helpers.ts` | the three ephemeral replies, each with Back + View games | AC3, AC8, AC9 |
| `lfg-composer-placement.helpers.ts` | the stay-last predicate, debounce, orphan sweep | AC1 |

Design decisions worth a reviewer's eye:

* **The urgency vocabulary is never hardcoded.** The spec is explicit that ROK-1616 owns
  those strings. `buildUrgencyRow` renders whatever `LFG_URGENCY_CHOICES` holds, and the
  soonest-first ordering is derived from each value's *horizon* (`now:30` -> `now`), not
  from its label — so 1616 can re-cut the labels with no edit here. An unranked horizon
  sorts last rather than throwing.
* **Urgency rides in the custom id as a derived, colon-free key** (`now:30` -> `now-30`),
  because the raw value's colon would forge a segment boundary. The term is always the
  LAST segment and is rejoined on parse, so a term containing `:` survives.
* **Term capped at 64 chars**, matching the modal input's `setMaxLength`, so anything
  typable always fits a custom id and `Back` can never hand back truncated text.
  `lfgc:go:now-30:2147483647:c:` + 64 = 93, under Discord's 100.
* **Trigram threshold 0.25**, not the experiment's 0.2 — it clears every measured
  recovery (0.27 `minecfaft` upward) and drops the worst false neighbour (`Valorant` for
  `valhiem` at 0.21). Tunable in one constant.
* **Never auto-select** is structural, not remembered: `candidates` and `fuzzy` are
  distinct outcome kinds rendered by one builder, and a lone trigram hit is still offered.

## Constraints — verified against the INSTALLED discord.js, not assumed

The tree has **14.27.0**, not the 14.26.4 the issue and spec cite. Both constraints still
hold on 14.27.0, checked directly against the typings:

* `LabelBuilder` appears **0 times** — a select inside a modal remains unbuildable.
* `ModalSubmitInteraction` has **no `showModal`** — a modal submit cannot open another
  modal. The spec asked for this to be verified before building; it is verified. The
  whole Back/Try-again shape (reopen from a *button*, never from a submit) is correct.

## Green — exactly what was run

From `api/`, on the final tree:

* `npx jest src/discord-bot/lfg-composer/` → **4 suites, 50 tests, all passing.**
* `npx tsc --noEmit -p api/tsconfig.json` → **no errors in `lfg-composer`.** (Requires
  `npm run build -w packages/contract` first in a fresh worktree; unbuilt contract types
  make the whole api tree red. Not a repo defect, so nothing was filed to the backlog.)
* `npx eslint api/src/discord-bot/lfg-composer --max-warnings=0` → **clean**, zero errors
  and zero warnings. No file is near the 300-line cap.

Not run: the full api suite, anything on the fleet, any browser or Discord smoke. This
lane never pushed and never opened a PR.

## Red / not built — the next lane's work

1. **The listener wiring (AC4, AC5).** Nothing routes `lfgc:*` yet. Needs a
   `LfgComposerListener` on the `LfgJoinListener` pattern: `OPEN`/`BACK` -> `showModal`,
   modal submit -> search + reply, `PICK` -> urgency reply, `GO` -> **`LfgService.createIntent`**
   (AC4: the same method `/lfg` calls — no second write path). AC5's unlinked/blocked
   check must run **before** `showModal`, reusing `resolveLfgCaller` and the existing
   `LFG_UNLINKED_REPLY` / `LFG_BLOCKED_REPLY` strings. Note `InteractionListener` today
   only routes chat-input and autocomplete; button/select listeners bind to the gateway
   themselves via `DiscordListenerBinding` (see `lfg-join.listener.ts`).
2. **The repost service (AC1).** `decideComposerPlacement` is the brain; the delete +
   repost + id-tracking and the `renderInFlight` flag the board's `flushAll`/`editThread`
   must set are not written.
3. **AC6 opt-in and AC7 permissions.** No setting, no column, no permission probe. The
   predicate takes `enabled` so both land as one flag.
4. **Companion-bot smoke spec.** Not written.

## Operator question — AC1 may not be implementable as written

**The LFG board's default surface is a `ForumChannel`** (`lfg-board-channel.service.ts`
`resolveForum`; text is only the fallback in `lfg-board-surface.helpers.ts`). A forum
channel has no channel-level message list — you cannot post a plain message into one,
only threads. So "a pinned composer card kept as the **last message** in the board
channel" has no forum implementation. The options, none of which this lane picked:

* **(a)** The composer lives only on **text-surface** boards, and forum-backed guilds
  keep `/lfg`. Smallest change; leaves the majority surface without the affordance.
* **(b)** The composer is a **forum thread** that gets bumped. Forum threads sort by
  activity, so "last" becomes "most recently bumped", and bumping means posting in it —
  a different and noisier mechanism than AC1 describes.
* **(c)** The composer goes in the **guild's `lfg` text channel** (if one is bound) while
  the board stays a forum — the card and the posts live in different channels, which
  contradicts the story's premise that you post from the channel you're reading.

This needs an operator ruling before the repost service is written. Everything already
built is surface-agnostic and survives any of the three.

**No new design-system pattern was introduced** — this story turned out to be entirely
Discord-bot surface, with no web UI at all, so `docs/design-system.md` does not apply.
