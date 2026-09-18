# Discord testing tools — reference

> Extracted from `CLAUDE.md` on 2026-09-18 to keep the always-loaded project
> instructions small. **The rules still live in CLAUDE.md** ("## Discord
> Testing"): run the smoke suite before pushing bot changes, never weaken an
> assertion, never `sleep()`. This file is the tool inventory you consult after
> you know the rule. Authoring standards live in `TESTING.md`. Not
> independent — do not add rules here.

## Launch Discord with CDP

```bash
./scripts/launch-discord.sh          # Launch with CDP on port 9222
./scripts/launch-discord.sh --kill   # Kill + relaunch with CDP
```

## Companion bot (`tools/test-bot/`) — API-level testing

A discord.js v14 bot. CI-compatible, stable, uses official Discord APIs.

- **Config:** `tools/test-bot/.env` (token + guild ID are static; channel IDs are per-test)
- **Programmatic usage:** `import { connect, readLastMessages, joinVoice, ... } from '../tools/test-bot/src/index.js'`
- **Helpers:**
  - Messages: `readLastMessages(channelId, count)`, `waitForMessage(channelId, predicate, timeout)`, `readDMs(count)`
  - Voice: `joinVoice(channelId)`, `leaveVoice()`, `moveToChannel(channelId)`, `getVoiceMembers(channelId)`
  - Interactions: `clickButton()`, `selectDropdownOption()` (limited — bots can't click other bots' buttons via Discord API)
  - Deterministic polling (replaces `sleep()`): `pollForEmbed(channelId, predicate, timeout)`, `waitForEmbedUpdate(channelId, predicate, timeout)`, `waitForDM(userId, predicate, timeout)`, `pollForCondition(check, timeout)` — see `tools/test-bot/src/helpers/polling.ts`
- **Key limitation:** bots cannot interact with other bots' message components. Test button/interaction handlers directly in NestJS integration tests instead.

## MCP Discord tools (`tools/mcp-discord/`) — UI-level verification

Playwright-over-CDP. Local dev only; requires Discord running with CDP. Registered in `.mcp.json` as `mcp-discord`, exposed as `mcp__mcp-discord__*`.

Seven tools: `discord_screenshot`, `discord_read_messages`, `discord_navigate_channel`, `discord_verify_embed`, `discord_click_button`, `discord_check_voice_members`, `discord_check_notification`.

Use for: visual verification of embeds, checking DM notification delivery, verifying voice channel membership as shown in the Discord UI, screenshots for debugging. **Not for CI** — requires local Discord Electron with CDP enabled.

## Which tool when

| Scenario | Tool | Why |
|----------|------|-----|
| Verify bot sends correct embed content | Companion bot (`readLastMessages`) | API-level, reliable, CI-safe |
| Verify embed renders correctly in Discord | MCP (`discord_verify_embed`) | Needs visual/DOM inspection |
| Check who's in a voice channel (API) | Companion bot (`getVoiceMembers`) | Uses guild cache, fast |
| Check voice UI shows members correctly | MCP (`discord_check_voice_members`) | Reads Discord sidebar DOM |
| Test button click handlers | NestJS integration tests | Bots can't click other bots' buttons |
| Debug what Discord looks like right now | MCP (`discord_screenshot`) | Visual aid |
| Wait for bot to respond to a command | Companion bot (`waitForMessage`) | Event-based, reliable |

## Test-only API endpoints (`/admin/test/*`, DEMO_MODE only)

Used by smoke fixtures for operations needing server-side coordination:

- `POST /admin/test/await-processing` — drain all BullMQ queues before asserting
- `POST /admin/test/flush-embed-queue` — drain embed sync queue
- `POST /admin/test/flush-notification-buffer` — flush buffered notifications
- `POST /admin/test/flush-voice-sessions` — flush in-memory voice sessions to DB

Full list: `api/src/admin/demo-test-*.controller.ts` (start with `demo-test-core.controller.ts`).

## Test categories

Map to files in `tools/test-bot/src/smoke/tests/*.test.ts` — see file names for current coverage areas. Directory layout, CDP-gated tests, and test anatomy: `TESTING.md` → "Discord Smoke Tests (Companion Bot)".
