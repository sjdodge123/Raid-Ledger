# Spike Report: Discord E2E Testing Toolset (ROK-844)

**Date:** 2026-03-16
**Status:** Implementation complete, pending live validation

## Deliverables

### 1. CDP Connection to Discord Electron (macOS)

**Approach:** Launch Discord with `--remote-debugging-port=9222`, connect via Playwright's `connectOverCDP()`.

```bash
/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9222
```

**To validate:** Run `cd tools/mcp-discord && npx tsx src/probe-cdp.ts`

**Known risks:**
- Discord may ignore the `--remote-debugging-port` flag if their Electron build strips it
- Discord auto-updates may break CDP compatibility at any time
- The flag requires quitting Discord completely and relaunching from terminal

**Fallback:** Use Discord web client (`discord.com/app`) in a Playwright-managed browser. This avoids Electron coupling but requires user account credentials (ToS gray area).

### 2. Companion Bot Prototype

**Location:** `tools/test-bot/`

**Implemented helpers:**
- `connect()` / `disconnect()` — Client lifecycle with 15s timeout
- `readLastMessages(channelId, count)` — Fetch recent messages via REST
- `waitForMessage(channelId, predicate, timeout)` — Event-based message waiting
- `readDMs(count)` — Read bot's DM channel
- `joinVoice(channelId)` / `leaveVoice()` / `moveToChannel()` — Voice channel presence
- `getVoiceMembers(channelId)` — Read voice channel occupants from cache
- `extractEmbed()` — Structured embed data from message objects

**To validate:** Create a test bot application in Discord Developer Portal, add to dev server, run `cd tools/test-bot && npx tsx src/demo.ts`

### 3. MCP Discord Tool Prototype

**Location:** `tools/mcp-discord/`

**Implemented tools (7 total):**
| Tool | Description |
|------|-------------|
| `discord_screenshot` | Screenshot current view or specific element |
| `discord_read_messages` | Scrape visible messages from DOM |
| `discord_navigate_channel` | Navigate to a channel by guild+channel ID |
| `discord_verify_embed` | Extract embed data + screenshot |
| `discord_click_button` | Click a button by label text |
| `discord_check_voice_members` | Read voice sidebar members |
| `discord_check_notification` | Search DMs for text |

**To register as MCP server:** Add to `.mcp.json`:
```json
"mcp-discord": {
  "command": "npx",
  "args": ["tsx", "tools/mcp-discord/src/index.ts"]
}
```

### 4. Limitations

| Limitation | Impact | Workaround |
|-----------|--------|------------|
| **Bots cannot click other bots' buttons** (Discord API restriction) | Cannot test button interactions via companion bot | Use MCP/CDP tool or test handlers directly in integration tests |
| **Bots cannot observe other users' DMs** | Cannot verify DM delivery to real users | Test DM sending logic in integration tests; use MCP to check DM UI |
| **Discord DOM selectors are hashed/obfuscated** | MCP DOM scraping is fragile, breaks on Discord updates | Use ARIA roles, data attributes, text content; accept brittleness |
| **CDP requires Discord relaunch with flag** | Cannot attach to already-running Discord | Script to kill + relaunch Discord with flag |
| **Discord API rate limit: 50 req/s per bot** | Not a concern for testing volume | Add backoff if needed |
| **@discordjs/voice needs native deps** | `sodium-native` requires compilation | Falls back to `tweetnacl` (pure JS) if native build fails |
| **No CI for MCP tools** | CDP/UI tools are local-dev only | Companion bot is the CI path |

### 5. Electron vs Browser Comparison

| Factor | Electron (CDP) | Browser (Playwright) |
|--------|----------------|---------------------|
| **Auth** | Already logged in | Requires credentials |
| **Stability** | Tied to Discord Electron version | Standard Chromium |
| **CI-compatible** | No | Possible (headless) |
| **ToS risk** | Low (reading own app) | Medium (automating user login) |
| **Recommendation** | Use for local dev | Explore as CI alternative |

## Recommendations

1. **Companion bot is the primary investment** — Stable, CI-compatible, uses official APIs. Build full test suites around it.
2. **MCP/CDP is a development aid** — Useful for visual verification and ad-hoc debugging, not automated testing.
3. **Button/interaction testing** — Test via NestJS integration tests (call interaction handlers directly). The API limitation is fundamental.
4. **Next steps:**
   - Create test bot application in Discord Developer Portal
   - Run probe scripts to validate CDP and bot connection
   - Write first E2E test: voice attendance happy path (ROK-842 regression)
   - Add companion bot tests to CI pipeline

## Setup Instructions

### Companion Bot
1. Create a new Application in [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable `MESSAGE_CONTENT` privileged intent under Bot settings
3. Generate a bot token
4. Invite to dev server with: voice connect, send messages, read message history, embed links
5. Copy `tools/test-bot/.env.example` → `.env` and fill in values
6. `cd tools/test-bot && npm install && npx tsx src/demo.ts`

### MCP Discord Server
1. Quit Discord completely
2. Relaunch: `/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9222`
3. Copy `tools/mcp-discord/.env.example` → `.env`
4. `cd tools/mcp-discord && npm install && npx tsx src/probe-cdp.ts`
5. If probe succeeds, add to `.mcp.json` for Claude Code integration
