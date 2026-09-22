# HANDOVER — ROK-1619 lane b (web AC7 + emoji setting)

## Done
- `48490edd7` API: `lfg_now_indicator_emoji` app_settings key (no migration); `get/setLfgNowIndicatorEmoji` in `api/src/settings/settings-lfg-board.helpers.ts`; GET `/admin/settings/discord-bot/lfg-board` returns `nowIndicatorEmoji`, new PUT `.../lfg-board/indicator-emoji` (`LfgNowIndicatorEmojiSchema`, blank clears).
  ONE resolver: `resolveNowIndicatorEmoji(configured, cache?)` in `api/src/discord-bot/lfg-now/lfg-now-indicator.helpers.ts` — unset → 🎉, Unicode → as is, custom (`name`/`:name:`/`<:name:id>`) → guild cache by id then name, available → `{id,name}`, else 🎉. `findIndicatorEmoji` + `LFG_NOW_INDICATOR_EMOJI_NAME` removed. `LFG_NOW_INDICATOR_UNICODE` is now 🎉 (was ☀️; intended).
  Surfaces: board (`LfgBoardService.indicatorEmoji`, now async + SettingsService), invite DM (payload `spawnEmoji` = raw setting at send time, resolved with no cache → custom degrades to 🎉), group read (`spawnIndicatorEmoji` on `LfgGroupDetailDto`, present only when `pressWouldSpawnNow`).
- `be82acd85` specs: controller GET/PUT, DI stubs for SettingsService.
- `2ba29a2b5` web: `LfgJoinControl` `spawnsNow`/`spawnEmoji` → `LfgUrgencyChoice spawnGlyph` marks the `Right now` pick `🎉 Right now · starts the group` (glyph aria-hidden); `LfgJoinControl.test.tsx`.
- admin commit: `web/src/pages/admin/lfg-indicator-emoji-field.tsx` inside the LFG board card.

## Known limitations / NOT done
- DM + web cannot verify a custom emoji (no guild cache) → they show 🎉 for a custom setting; only the board card renders the custom one. Deliberate (AC5-safe); say so in the PR.
- `LfgJoinControl` is 36 lines (max-lines-per-function WARN, not error).
- No smoke asserts the DM/board label glyph; none added.
- Fleet test plan (operator check) not created — Lead's job.
