> **Source:** `planning-artifacts/INV-ROK-1590-2026-10-02.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-02
> **Linear:** ROK-1590

# ROK-1590 investigation (cycle 23) — verdict: BLOCKED on operator

HEAD read: 2a204304497ad1f67a8a3896ddc318fa84b272a6. No spec file (planning-artifacts/specs/ROK-1590.md absent). Linear: In Progress; 3 comments (2026-09-23) — pass-1 summary, operator rulings C1–C12 "yes to all", relay-hub direction (RM-1..RM-6).

## Already done
- Report: docs/spikes/rok-1590-one-click-deploy.md (local, gitignored; §0–§17, rulings §12, story list §14, relay §17).
- Prototype artifact approved (C1–C12, D-1..D-7).
- Spike-found bugs shipped: ROK-1663 backup prune (#1339), ROK-1664 BullMQ rediss (#1361), ROK-1665 rate-limit trust proxy (Done; main.helpers.ts:224-252 resolveTrustProxy).
- render.yaml disk path fixed (mountPath /data, PR #1312).
- Relay work moved to Epic ROK-1666 (ROK-1667, 1668 shipped; 1671, 1673, 1675 Backlog).

## What is left, and why an agent can't do it
1. §13 throwaway proof deploys (Render R-1..R-3, Railway RW-1..RW-3, Fly F-1..F-4) need the operator's own Render/Railway/Fly accounts, a test guild and a fresh Discord app. Agents never create accounts or enter credentials.
2. §14 follow-up stories #4–#16 (resolver, :stable tag, prod-only node_modules, RL_FLAVOUR=cloud, claim, invite fallback, wizard, render.yaml image Blueprint + button, Railway template, fly.toml, update card, Host-your-own docs) are NOT filed in Linear (searched). Report says "not filed; the operator triages".
3. The revised Keys / "Game data" sheet (D-7 reopened by §17.10) has no recorded operator approval after the 18:47 comment.
4. Relay decisions R-1 (hub domain: raid-ledger.com ownership, relay.service.ts:18) and R-2 (hub hosting account) are operator actions (§17.13) — tracked under ROK-1666 now.

## Still-live code gaps on HEAD (ready to file; not shipped under the spike)
- §14 #3: nginx/monolith.conf.template:124 `/p/lineup` sets `X-Forwarded-Proto $scheme` (lines 77/91 use `$proxy_proto`). Infra — own PR + allinone build/health check. Note: request-origin.helpers.ts:15 and discord-auth.helpers.ts:102 read x-forwarded-proto.
- §14 #9: discord-bot-client.service.ts:176-179 getClientId() is null until the gateway is ready, so discord-bot-invite.controller.ts:33-35 returns url:null before the bot connects (no fallback to the saved OAuth client id). Stale copy: discord-bot-invite-panel.tsx:18-19 ("client ID is saved on this page") and discord-bot.service.ts:216 ("OAuth2 URL Generator in the Developer Portal").
- render.yaml still `plan: starter` (512 MB; measured boot peak 557 MB) and `healthCheckPath: /api/health` (story #12 replaces it).
