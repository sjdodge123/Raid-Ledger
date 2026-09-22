# HANDOVER — ROK-1619 AC7 (+ emoji setting, scope added mid-lane)

Branch `feat/rok-1619-ac7-indicator-everywhere`. Lane stopped at its turn budget; tree clean after this commit.

## Done (committed, api tsc 0, eslint 0 errors, 6 suites / 105 tests green)
- `2eb48076e` — shared predicate stays `pressWouldSpawnNow` in
  `api/src/discord-bot/lfg-now/lfg-now-indicator.helpers.ts`; new adapter
  `groupReadPressWouldSpawnNow(groupRead, viewerHoldsNowHand)` beside it (no second rule).
  - Contract: `LfgGroupDetailSchema.pressWouldSpawnNow: z.boolean().optional()` (packages/contract — escalates the gate to standard/--full).
  - `api/src/lfg/lfg-group-detail.helpers.ts::readGroupDetail` (extracted from `LfgService.getGroupDetail`, which sat at 300 counted lines) sets it per viewer (`ownIntent.urgency === 'now'` -> false).
  - Invite DM: `LfgInviteService.spawnsNowField` stores `spawnsNow: true` in the `lfg_player_invite` payload at send time (recipient never holds a hand — `in_group` refuses the send). `buildLfgPlayerInviteRow` renders `Join · starts the group` + Unicode ☀️ via `resolveNowIndicatorEmoji(null)`; custom id unchanged.
  - The ROK-1613 start-now invites (`lfg-now-invite.helpers.ts`) go out AFTER the spawn -> never marked (correct: those presses attach).
- `fd13315ca` — tests: adapter parity with the predicate across threshold±; invite payload spawnsNow true / absent when live; new `notification-embed.lfg-player-invite.spawn.spec.ts` (label, emoji, literal-true only, custom id unchanged, 80-char cap).
- Smoke: `tools/test-bot/src/smoke` has NO assertion on the DM Join label -> no smoke spec touched.

## Known limitation (record in PR)
The DM is a send-time snapshot and is never re-rendered, so a stale ☀️ can outlive the spawn (AC3 is about the board). A stale press degrades to AC4's graceful attach. Say so in the PR; don't "fix" by editing DMs without an operator ruling.

## NOT done — web (next lane, ~6 turns)
`web/src/pages/lfg/LfgJoinControl.tsx`:
1. Add prop `spawnsNow?: boolean`; `lfg-group-top.tsx:61` passes `group.pressWouldSpawnNow === true`.
2. The press that crosses is the **`Right now` pick**, not the `+1` button (it only opens `LfgUrgencyChoice`). Recommended: optional `nowStartsGroup?: boolean` on `web/src/components/lfg/lfg-urgency-choice.tsx`, rendering the `now` choice as `☀️ Right now · starts the group` (the words carry it, AC6; glyph `aria-hidden`), and a small aria-hidden ☀️ on the `+1` button. Copy goes in `web/src/pages/lfg/lfg-copy.ts` (`lfg-copy.guard.test.ts` scans LFG source; avoid `30 min|60 min|1 hour`). Tokens only, no raw colours.
3. Component test `LfgJoinControl.test.tsx`: spawnsNow true -> open choice, `lfg-urgency-now` contains "starts the group"; false/absent -> it doesn't.
4. `npx tsc --noEmit -p web/tsconfig.app.json`; `cd web && npx vitest run <paths>`.
5. Operator check needs a fleet test plan (CLAUDE.md) seeding a group at `threshold-1` now-hands.

## NOT done — emoji SETTING (operator scope add 2026-09-22)
Spec from the Lead: admin-configurable emoji for the indicator, used by the web and the Discord buttons; when unset OR unusable, fall back to **🎉** (NOTE: this replaces today's ☀️ fallback — `LFG_NOW_INDICATOR_UNICODE` and its spec assertions change deliberately; the operator's `:praise_sun:` name lookup likely becomes the setting's value).
Plan:
1. Find the pattern: `api/src/drizzle/schema/app-settings.ts` + `api/src/settings/` (SETTING_KEYS / typed getters; `settings-bot.helpers.ts::getClientUrl` is a model getter). app_settings is key/value -> probably **no migration**; confirm before generating one (if needed: drizzle-kit generate, no hand edits, `./scripts/fix-migration-order.sh --check`).
2. Value shape: a Unicode emoji or a custom-emoji name/`<:name:id>`. Resolve in ONE helper next to `resolveNowIndicatorEmoji`: custom -> look up in the guild cache (by id, then name), `available !== false`, else 🎉; Unicode -> use as is. Never emit a raw `<:name:id>` string (AC5).
3. Wire: `LfgBoardService.indicatorEmoji()` (lfg-board.service.ts ~l.280), `buildInviteJoinButton` in `notification-embed.lfg-player-invite.ts` (DM has no guild — pass the resolved emoji via the notification pipeline, or resolve against the bot's guild at render), and the web (add the resolved Unicode glyph — or 🎉 when custom — to `LfgGroupDetailDto`, contract change, or a public settings read).
4. Admin panel field: grep `web/src/pages/admin` for a comparable bot text setting and mirror it.
5. Tests: unset -> 🎉; custom unavailable -> 🎉; custom available -> `{id,name}`; never `<:` in a label.
