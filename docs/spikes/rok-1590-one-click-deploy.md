> **Source:** `planning-artifacts/one-click-deploy-spike-2026-09-23.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-09-23
> **Linear:** ROK-1590

# ROK-1590 spike: one-click cloud deploys and a zero-config first run

**Date:** 2026-09-23 · **Code read at:** `origin/main` 15f3c7d8f · **Status:** desk research, a code trace and one local memory measurement. **Revised 2026-09-23** after the operator's rulings (§12) and the relay model (§17: identity from Wikidata, no IGDB content through the hub, no IGDB email): §0, §7, §10, §12 and §14 were updated to match.

**Not done yet:** throwaway deploys. They need the operator's own accounts, and agents never create accounts or enter credentials. §13 is the plan for them.

**Inputs.** Three research lanes, synthesised here:
- **Providers:** official docs and pricing pages, fetched 2026-09-23.
- **Runtime:** the code on origin/main plus one measured container run.
- **First run:** a trace of the first-visit code path.

This reuses, and does not redo, `rok-1476-second-deployer-audit.md` and `rok-1476-provider-terms-addendum.md`. The render.yaml disk-path blocker is fixed on main (`mountPath: /data`, 1 GB, PR #1312).

**Conventions.** **UNVERIFIED** = no official page or run confirmed it; each needs a throwaway deploy or a question to the provider. Provider claims are paraphrased; tags like [R5] point to §15 (verbatim quotes are in the providers-lane output). Costs are arithmetic on verified unit prices, "est." where usage-dependent. Re-checked against origin/main this pass: the GHCR package is **public** (anonymous pull token + `:main` manifest both HTTP 200); per-boot migration dumps are **never pruned**; BullMQ keeps only host, port and password from `REDIS_URL`. Ten load-bearing provider claims were re-checked adversarially against official pages the same day. The verdicts are in §16, and nothing changed the recommendation.

---

## 0. TL;DR

1. **Default: Render, about $26–28/mo** — the allinone image pulled from public GHCR, a persistent disk, the Standard 2 GB plan ($25 + 5–10 GB disk). The only provider meeting the whole frictionless target today: in-repo Blueprint, Deploy button, generated secrets, disk, full public-URL env var.
2. **Budget: Fly.io, about $6.50–11.50/mo** (allinone + volume, 1–2 GB machine; Ashburn base prices, up to about 1.3× in other regions), CLI-only (`fly launch`), no button. **Middle: Railway, about $6–12/mo est.** (usage-billed, allinone + volume), with a button, but the template lives in Railway's UI, not our repo.
3. **Drop Heroku and DigitalOcean from one-click:** no persistent disk, so split topology only (managed Postgres + Redis). Heroku is $70+/mo, in "sustaining engineering" and needs a CLI-only labs flag for its URL; DO's button offers only Dev Databases (pgvector UNVERIFIED) and has no secret generator. No free tier anywhere runs the image.
4. **Measured:** about 314–320 MiB idle, 557 MB boot peak (cgroup, incl. page cache), so Render's 512 MB Starter plan (`render.yaml:6` today) is too tight for a stranger's default and 1 GB is the floor. Image 288 MB compressed / 1.6 GB unpacked, 62% of it `node_modules` still carrying dev dependencies.
5. **The templates are the small part.** The real work is a platform URL resolver, claim-on-first-visit and an in-app Discord wizard, plus three latent bugs found on the way: rate limits collapse onto the proxy's IP (may affect prod today), per-boot pre-migration dumps are never pruned, and BullMQ drops `rediss://` TLS.
6. **Relay hub by default (§17, operator decision 2026-09-23).** A fresh instance needs zero data-feed keys. The hub serves:
   - **Identity:** an RL game ID mapped to Wikidata, IGDB, Steam and ITAD IDs, taken from Wikidata (CC0). The only other IDs served are Steam app IDs an instance got from Steam itself and, from M3, ITAD IDs the hub confirmed with its own lookup (D15).
   - **Metadata:** from Wikidata.
   - **Prices (after R17):** ITAD, relayed under the 09-20 addendum's five conditions.

   IGDB never passes through the hub. It is an optional per-instance key for covers and descriptions, so **no IGDB email is needed**. Steam, Blizzard and Twitch stream counts stay own-key. The image's 49-game seed is IGDB content and gets rebuilt from Wikidata before the public launch. The hub costs the operator about $12–16/mo.

---

## 1. Verified provider table (fetched 2026-09-23)

| | Render | Railway | Fly.io | Heroku | DigitalOcean App Platform |
|---|---|---|---|---|---|
| **One-click mechanism** | Deploy button + `render.yaml` Blueprint in repo [R1] | Button → template **built in Railway's UI**, not a repo file [RW1][RW2] | **No button.** CLI `fly launch --from <repo>` / `--image` [F1] | Button + `app.json`; **builds from source** [H1] | Button + `.do/deploy.template.yaml`; **public repos only** [D1] |
| **Prebuilt GHCR image** | Blueprint `runtime: image` + `image.url`; public images need no creds [R2][R3]. Button + image Blueprint end-to-end **UNVERIFIED** | Template service source can be a Docker image [RW2] | `[build] image` deploys an existing public image [F2] | Button builds from source; `stack: container` via button **UNVERIFIED** [H1][H2] | App spec supports `registry_type: GHCR` [D2]; image via button **UNVERIFIED** (docs show git only) [D1] |
| **Persistent disk** | Paid services only, $0.25/GB/mo [R4][R5] | 1 volume/service, $0.15/GB/mo; Hobby cap 5 GB [RW3][RW4] | Volumes $0.15/GB/mo, 1 GB default, 500 GB max [F3][F4] | **None** (ephemeral fs) [H3] | **None** (no volume support) [D3] |
| **Cheapest always-on ≥1 GB** | Standard `1c-2g` 2 GB **$25**; Starter 512 MB $7 [R5] | Usage: RAM $10/GB-mo, vCPU $20/mo; Hobby $5 incl. $5 usage [RW4] | shared-cpu-1x 1 GB **$5.70**, 2 GB **$10.70** (Ashburn base; regional markup up to 1.30×) [F3] | Standard-2X 1 GB **$50**; Basic 0.5 GB $7 [H4] | 1 GB **$10** (fixed) / $12; 2 GB $25 [D4] |
| **Free / trial, sleep** | Free spins down after 15 min without inbound traffic, no disk; free Postgres expires at 30 days [R6] | $5 one-time trial ≤30 days, then $1/mo credit [RW5]; Free capped at 0.5 GB RAM [RW4]; sleep is a per-service setting (opt-in default **UNVERIFIED**); outbound traffic keeps it awake [RW6] | Trial 2 VM-hours or 7 days; trial machines stop after 5 min [F5] | Eco sleeps after 30 min without web traffic [H5]; no free tier | Static sites only [D4] |
| **Managed Postgres + pgvector** | Yes [R7]; $6 (256 MB), $19 (1 GB) [R5] | pgvector template, **unmanaged** [RW7] | Managed PG supports pgvector; from **$38/mo** [F6] | pgvector on Essential plans [H6]; Essential-0 $5 [H4] | Supported [D5]; $15/mo min [D6]; button offers Dev DBs only, pgvector there **UNVERIFIED** |
| **Redis for BullMQ** | Key Value = Valkey 8; `noeviction` advised for queues; persistence on paid; 256 MB $10 [R8][R5] | Official `redis` image, unmanaged [RW8] | Upstash only; PAYG $0.20/100k requests; fixed plans (from $10) advised for BullMQ [F7] | Mini $3 = 25 MB, **data lost on reboot**, TLS with self-signed cert [H7]; Premium-0 $15 = **50 MB** [H4] | Managed Valkey from $15 (1 GiB) [D7]; `noeviction` **UNVERIFIED** |
| **Generated secrets** | `generateValue` (random 256-bit, base64) [R2] | `${{ secret(len, alphabet) }}` [RW2] | None found; absence **UNVERIFIED** | `"generator": "secret"` [H2] | `SECRET` type only, no generator [D2] |
| **Public-URL env var** | `RENDER_EXTERNAL_URL`, full https URL [R9] | `RAILWAY_PUBLIC_DOMAIN`, hostname only [RW9] | `FLY_APP_NAME` → `https://$FLY_APP_NAME.fly.dev` (suffix confirmed, §16) [F8] | `HEROKU_APP_DEFAULT_DOMAIN_NAME` via **CLI-enabled labs feature** [H8] | `${APP_URL}` / `${APP_DOMAIN}` bindables [D8] |
| **TLS / XFP / WS / PORT** | Edge TLS; WS supported [R10]; X-Forwarded-Proto **UNVERIFIED**; `PORT` default 10000 [R9] | XFP always `https`, plus X-Forwarded-Host, X-Real-IP; WS exempt from limits [RW10]; `PORT` injected [RW11] | XFP, Fly-Client-IP [F9]; WS works [F10]; **no PORT**, `internal_port` in fly.toml [F2][F8] | XFP/For/Port; WS; 55 s idle timeout; must bind `$PORT` [H9] | `PORT` from `http_port` [D2]; WS [D9]; XFP **UNVERIFIED** |

**Provider-specific constraints (verified unless marked).**
- **Render:** a disk-backed service can't scale past one instance; deploys stop the old instance first (a few seconds of downtime); disk snapshots daily, kept ≥7 days; image-backed services **don't auto-redeploy** on a new image (use "Deploy latest reference" or a deploy hook with `imgURL`).
- **Railway:** volumes rule out replicas and cause brief downtime on redeploy; the plans page says Pro can self-serve volumes up to 1 TB (another Railway page said 50 GB; the plans page is the pricing reference); auto-redeploy on a new image **UNVERIFIED**.
- **Fly:** volumes are tied to one host and Fly advises two per app, which allinone can't follow; snapshots 5 days by default (1–60 configurable); `auto_stop_machines` must be pinned off or the bot's gateway connection drops.
- **Heroku:** our Redis client has no TLS / self-signed-cert handling; the button can't target the newer "Fir" platform; "sustaining engineering" announced 2026-02-06 [H10].
- **DigitalOcean:** Dev Databases lack database-creation permissions, so `CREATE EXTENSION vector` is likely blocked (**UNVERIFIED**).
- **Koyeb:** volumes in public preview, "only suitable for testing" per Koyeb, so not better. **Northflank:** not researched.

---

## 2. Topology per provider

**Measured memory.** One idle local run of the allinone image: aarch64, 2 weeks old, no Discord bot, no data, about 90 s of uptime.

| Reading | Value |
|---|---|
| `docker stats` at 35 s / 90 s | 313.9 / 320.4 MiB |
| cgroup `memory.peak` (migrations, seeding, pg_dump) | 557 MB, including reclaimable page cache |
| cgroup anonymous memory | 170 MB |
| RSS: node / Postgres (10 procs, shared buffers counted repeatedly) / supervisord / redis / nginx per worker | 183 / about 160 / 24 / 11 / 6.6 MB |
| Fresh PGDATA · start → healthy | 52 MB · about 35 s |

This is a **floor**:
- No bot was connected. discord.js caches guild members and presences.
- Postgres `shared_buffers` (128 MB) fills as the database is used.
- Cron jobs and the 02:00 pg_dump add load.
- Fleet cross-check: each env uses at most about 0.7 GiB (host 6.2 GiB, runners 4.0 GiB).
- nginx `worker_processes auto` started about 11 workers on 10 cores. A PaaS reports the host's core count, so pin 1–2 workers.

**Verdict:**
- **1 GB is the realistic floor.**
- **512 MB might boot:** most of the peak is reclaimable cache, and anonymous memory was only 170 MB. But it leaves no headroom for the bot, so it isn't a stranger's default.
- **Render's Starter plan is worth trying** in the throwaway deploy (§13) as a cost-down experiment, not as the default.
- `MEMORY_RESTART_THRESHOLD_MB` (`api/src/common/perf-memory-monitor.ts:13-20`) is already there as a safety valve.

| Provider | Recommended shape | Plan | RAM headroom (vs about 0.32 GiB idle) | Disk |
|---|---|---|---|---|
| **Render** | allinone + disk at `/data` | Standard 2 GB ($25). No 1 GB tier exists [R5] | Large | 5–10 GB ($1.25–2.50) |
| **Railway** | allinone + volume at `/data` | Hobby, usage-billed | Billed on actual use | 5 GB (the Hobby cap) |
| **Fly.io** | allinone + volume, 1 machine, `auto_stop_machines = "off"` | shared-cpu-1x 1 GB ($5.70) or 2 GB ($10.70) | 1 GB is tight but plausible; 2 GB is comfortable | 5 GB ($0.75) |
| **Heroku** | split only | Standard-2X + Essential-0 + Premium-0 Redis | n/a | none (ephemeral) |
| **DigitalOcean** | split only, hand-built app spec (not the button) | 1–2 GB app + managed PG + Valkey | n/a | none (ephemeral) |
| NAS / VPS (today) | allinone + named volume | n/a | n/a | n/a |

**Split topology: half-proven, not shippable yet.**
- **What works:** the API accepts an external `DATABASE_URL` / `REDIS_URL` (`drizzle.module.ts:18-26`, `redis.module.ts:25-29`). The fleet already runs allinone against a pgvector sidecar (`rl-infra/orchestrator/bin/env-spin:676-690, 785`).
- **What only looks like it works:** the fleet envs boot only because the **embedded** Postgres and Redis still autostart.

To make split real:
- **a. Supervisor.** Gate `[program:postgres]` and `[program:redis]` on an env var (`Dockerfile.allinone:232-257`).
- **b–c. Boot waits.** `start-api.sh` waits on `pg_isready -h localhost` and on `redis-cli -s /tmp/redis.sock` (`:333-342`). With external services these hang forever, so probe the URLs instead.
- **d. Local database init.** Skip `init-db.sh` and the local-pg extension step (`:427-459, 592, 600-610`).
- **e. BullMQ** keeps only the host, port and password (`api/src/queue/queue.module.ts:64-69`, re-checked). That drops `rediss://` TLS and the ACL username, even though `redis.module.ts:29` passes the full URL.
- **f. IGDB cache flush** goes over the unix socket (`api/scripts/docker-entrypoint.sh:72-76`).
- **g. Extensions.** The app role must be able to create `vector` (required: `0120`), `pg_trgm` (`0086`) and `pg_stat_statements` (`0131`).
- **h. pg_dump 16 client** can't dump a PG 17 server, so the daily backup fails there.
- **Diskless hosts:** `JWT_SECRET` **must** come from the platform. A regenerated `/data/.jwt_secret` changes the app_settings encryption key (`api/src/settings/encryption.util.ts:72-74`), which makes the bot token and API keys unreadable.

Split stays **deferred** until a provider that needs it is back in scope.

---

## 3. Image strategy and the "cloud flavour"

**Pull, don't build.**
- The GHCR package is public; an anonymous token and the `:main` manifest both returned 200 today.
- `render.yaml:4-5` still **builds from source** (`runtime: docker`, `dockerfilePath`). That goes against target #5: it spends Render build minutes and needs our monorepo toolchain.
- All three recommended providers accept an image: Render `runtime: image` [R2], a Railway image source [RW2] and Fly `--image` [F2].
- The one unknown is whether **Render's button honours an image-backed Blueprint** (UNVERIFIED, test #R-2 in §13).

**Published tags** (`ci.yml:1025-1047`, `docker-publish.yml:69-80`):
- `:main` and `:<sha>` on every push to main, gated on unit, integration and smoke tests
- `:X.Y.Z`, `:X.Y` and `:<sha>` on `v*` tags
- **No `:latest` and no moving stable tag; `linux/amd64` only.**

Templates should track a **new moving `:stable`** (or `:X` major) tag cut from releases, never `:main`. A stranger shouldn't get every merge.

**Image size:**
- 288 MB compressed (39 layers) and 1.61 GB unpacked.
- **62% is one 998 MB `node_modules` layer.** `Dockerfile.allinone:49` runs `npm ci` with dev dependencies and `:174` copies the whole thing. Examples of what ships:
  - typescript 23 MB, vite 20 MB, @angular-devkit 42 MB
  - @rolldown 34 MB, playwright-core 13 MB, @heroicons 21 MB
- An api-only `npm ci --omit=dev` / `npm prune` stage is the real size win, likely several hundred MB. Measure it before promising a number. It helps **every** flavour, including the NAS.
- Other layers: apk runtime 118 MB, node base about 145 MB, api dist 22 MB, web dist 17 MB, migrations 16 MB, pgvector 7.9 MB.

**Cloud flavour: make it a runtime mode (`RL_FLAVOUR=cloud`) on the same image, not a second image.**
- **What a separate image would save:** only the 5.1 MB glibc donor layer (`Dockerfile.allinone:17-35, 102`) plus the `/data/ollama/models` directory.
- **Ollama isn't in the image.** The API downloads it at runtime (`ollama-native.service.ts:25-27, 110-115`). That path has been dead in allinone since ROK-1036: the API runs as uid 1001, so it warns and skips (`:58-68`). A second image would double CI publishing for 5 MB.
- **The real benefit is behavioural:**
  - no multi-GB Ollama download onto a metered disk
  - Co-Optimus hard-off
  - `DEMO_MODE` and `FLEET_*` refused
  - nginx pinned to 1–2 workers
- **Operator call:** since native Ollama is dead in allinone anyway, deleting the glibc donor stage outright may be the simpler move for every flavour.

---

## 4. Platform URL resolver

**Today.** Three independent places derive the public URL, and only Render is detected:
- **Shell.** `start-api.sh` swaps `CORS_ORIGIN=auto` only for `$RENDER_EXTERNAL_URL` and copies `CLIENT_URL` from `CORS_ORIGIN` (`Dockerfile.allinone:398-413`).
- **`ClientUrlSeederService`.** Uses trusted anchors only, following ROK-1627: `app_settings.client_url`, then the origin of `discord_callback_url`, then the origin of `DISCORD_CALLBACK_URL` (`client-url.helpers.ts:63-70`).
- **Discord callback.** Taken from the saved setting, else the env var, else `http://localhost/api/auth/discord/callback` (`discord.strategy.ts:12-14`, `settings-bot.helpers.ts:34-42`).

Nothing in `api/src` reads the Railway, Fly, Heroku or DO variables. `PUBLIC_URL` is read nowhere, although the fleet sets it.

**Design.** Add `resolvePlatformPublicUrl(env): { url, source } | null` in `api/src/settings/client-url.helpers.ts`, next to the ROK-1627 trusted-anchor rule. It uses deployer-controlled env only, **never request headers**.

| Precedence | Source | Normalise |
|---|---|---|
| 1 | `PUBLIC_URL` (explicit; also the NAS / custom-domain escape hatch) | Trim the trailing `/`, require http(s) |
| 2 | `RENDER_EXTERNAL_URL` | Already a full URL |
| 3 | `RAILWAY_PUBLIC_DOMAIN` | `https://` + hostname |
| 4 | `FLY_APP_NAME` | `https://<name>.fly.dev` (suffix confirmed, §16) |
| 5 | DO `APP_URL` | Full URL (bindable) |
| 6 | Heroku `HEROKU_APP_DEFAULT_DOMAIN_NAME` | `https://` + host. Needs the labs flag, so it's documented, not relied on |

**Where the result goes:**
- **(a) `CORS_ORIGIN`.** Replace the shell block with a Node call, or have the shell call a tiny `dist/scripts/resolve-public-url.js` so the logic exists once.
- **(b) CLIENT_URL seeder.** Becomes its **lowest-trust** anchor, below the three existing ones. A saved admin setting always wins.
- **(c) Default Discord callback** = `<url>/api/auth/discord/callback`. The wizard's copy-buttons already use `window.location.origin`.
- **Boot log:** one line, `public URL: <url> (from RAILWAY_PUBLIC_DOMAIN)`, which closes audit item #6.
- **ROK-973:** with a resolved URL, `auto` (reflects any origin with credentials, `main.helpers.ts:176-177`) is no longer the PaaS default.
- **Custom domains:** the platform var still names the default host, so a custom domain needs `PUBLIC_URL`. Say so in the docs.

---

## 5. Claim-on-first-visit

**Problem.**
- A stranger's first visit shows a bare login form (`login-page.tsx:179-181`).
- The only password is printed to stdout **once** (`bootstrap-admin.ts:341, 390-403`).
- `isFirstRun` (`system.controller.ts:60`, `userCount === 0`) is never true on allinone, because bootstrap has already inserted `admin@local`.
- A PaaS URL is guessable from the service name, so "first visitor wins" hands the instance to a stranger. The fleet's `FLEET_FIRST_DISCORD_LOGIN_ADMIN` works exactly that way and must never appear in a template.

**Recommended design:** use a platform-generated code where the platform can make one, and fall back to a logged code.

**The code:**
- **Source:**
  - `SETUP_CODE` env var, generated by the template: Render `generateValue`, Railway `${{secret(24, "ABCDEFGHJKMNPQRSTVWXYZ23456789")}}`, Fly `fly secrets set` in the launcher snippet.
  - If it's unset, bootstrap generates a code and logs it with the path (`/claim`). Bootstrap cannot know the origin (`bootstrap-admin.ts:376-379`), so it prints "prefix with your app URL". The resolver (§4) removes that caveat.
- **Strength:** at least 80 bits. Show generated codes as `XXXX-XXXX-XXXX-XXXX` (base32). A platform value is accepted verbatim; Render's is a long base64 string that users paste.
- **Storage:** only a hash lives in `app_settings` (`claim_code_hash`, `claim_expires_at`, `claimed_at`). Compare with `timingSafeEqual`. The env var outlives the claim, so **consumption is recorded in the DB**, and a consumed code never works again, even if the env var is unchanged.

**The flow:**
- **Endpoint:** public `POST /setup/claim {code, newPassword}` sets the `admin@local` password and `claimed_at`, then returns a session.
- **Status:** `GET /system/status` gains `claimRequired` (a boolean, never the code). While it is true, the web app sends every route to `/claim`.
- **Expiry:** 72 h from first boot. After that `/setup/claim` returns 410 with "restart the service for a new code", and an expired, unclaimed instance regenerates and logs a fresh code on boot.
- **Unclaimed instances** stay inert: empty DB, no bot. The only cost is idle hosting, which the docs should state.
- **Rate limiting:**
  - Reuse `@RateLimit('auth')` (10/min) plus a global soft lock (e.g. 100 failures/h locks claims for 15 min).
  - **Do not burn the code after N failures.** At 80 bits brute force is infeasible, and burning gives an attacker a way to deny the real owner.
  - Per-IP limits are meaningless until the trust-proxy bug (§9) is fixed.
- **HTTPS:** in cloud mode, refuse the claim unless the forwarded protocol is `https` (nginx passes `$proxy_proto`, `monolith.conf.template:77`).
- **Cloud mode bootstrap:** creates `admin@local` with an **unprinted** random password, and the claim sets the real one. `RESET_PASSWORD=true` stays the recovery path.
- **NAS mode:** keeps today's stdout banner (operator decision D-3).
- **Wizard:** the claim replaces the wizard's "Secure Account" step. `onboarding.controller.ts:105` hardcodes `secureAccount: false`.

---

## 6. Discord setup wizard

Setting up the Discord app is the step no button can automate. It is the dominant friction, probably 10–15 min for a first-timer (to be timed in §13).

**Developer Portal steps the wizard must walk through** (one application covers OAuth and the bot):
1. New Application → name it.
2. **OAuth2:** copy the Client ID, then Reset Secret. Add **both** redirects:
   - `<origin>/api/auth/discord/callback`
   - `<origin>/api/auth/discord/link/callback`
3. **Bot:** Reset Token. Enable the privileged intents **Presence**, **Server Members** and **Message Content**, then save. The client requests 8 intents (`discord-bot-client.helpers.ts:107-115`).
4. Open the generated invite URL and choose **exactly one** server. Only the first guild is used, and the bot warns when it is in more than one (`discord-bot-client.service.ts:301-306`).

**Already built, to reuse:**
- redirect URLs with copy buttons (`DiscordOAuthForm.tsx:21-38`)
- live OAuth validation (`settings-oauth.helpers.ts:25-75`)
- live bot-token validation (`discord-bot.service.ts:193-218`)
- the ROK-1471 invite URL with 17 permissions (`discord-bot-client.helpers.ts:20-91`)
- a guild/permission check (`DiscordBotForm.tsx:77-143`)
- the server-side checklist `SETUP_STEP_DEFS` (oauth, bot-token, bot-connected, default-channel, timezone), which becomes the wizard's progress model

**Gaps:**
- **Invite URL arrives late.** It needs the bot connected, because `getClientId()` is null until ready (`discord-bot-client.service.ts:176-179`). Fall back to the saved OAuth client ID, which belongs to the same application.
- **Stale copy strings:**
  - `discord-bot-invite-panel.tsx:17-18` says the client ID unlocks the invite; really the bot token does.
  - `discord-bot.service.ts:211-212` tells users to hand-build the URL in the "OAuth2 URL Generator".
- **No waiting step.** Nothing waits for the join. Poll bot status until `connected && guildName`, then run the permission check automatically.
- **Discord is not in the wizard.** Today's wizard (`admin-setup-wizard.tsx:11-16`) has no Discord step, and its Plugins card is a client-only stub that saves nothing (`connect-plugins-step.tsx:13-24`). **Delete it.**
- **UNVERIFIED:**
  - whether a disallowed-intent error reaches `friendlyDiscordErrorMessage` with actionable text
  - the Developer Portal deep-link format for a given application ID

**Minimal screens, as input to the design step.** CLAUDE.md requires a design first, and the operator picks.
1. **Claim** (§5).
2. **Community:** name and timezone (reuses `CommunityIdentityStep`).
3. **Discord application:** read-only redirect URLs with copy buttons; Application ID, Client Secret and Bot Token, each with a live ✓; an intents checklist with a portal deep link.
4. **Invite your bot:** the invite URL and permission list, then "Waiting for your bot…" until the guild, member count and permission check come back. Warn if the bot is in more than one server.
5. **Default channel** picker.
6. **Optional integrations** (§7, skippable).
7. **Done:** "Sign in with Discord to link your admin", plus a backups note and an update note.

---

## 7. Game data and optional keys: the relay by default, your own keys as the upgrade

*Revised 2026-09-23 for the operator's relay model (identity, not IGDB content). The design is in §17.*

- **Default for new installs, cloud and NAS alike:** game data comes from the Raid Ledger relay hub (§17), so a fresh instance needs **zero data-feed keys**. The hub serves:
  - **Identity:** a canonical Raid Ledger game ID and a crosswalk to the Wikidata QID and the IGDB, Steam, ITAD and Twitch IDs, plus normalized forms of served titles and aliases only. The cross-reference IDs come from Wikidata (CC0); the only others served are Steam app IDs an instance got from Steam itself and, from M3, ITAD IDs the hub confirmed with its own lookup (D15, §17.1).
  - **Metadata:** title from Wikidata or the relay admin; dates, platforms, genres and modes from Wikidata plus the rebuilt seed's RL fields (only values proven hand-written, §17.8).
  - **Prices (after R17):** ITAD, relayed under the 09-20 addendum's five conditions.
  - **Never IGDB content.** The hub has no IGDB credentials. IGDB is an optional per-instance upgrade, stored locally. No IGDB email is needed (ruled 2026-09-23).
- **The offline floor stays, but the seed has to change.** The image ships a 49-game seed (`api/seeds/games-seed.json`, loaded on every boot by `docker-entrypoint.sh:56-69`).
  - **Today it is IGDB content:** `"source": "igdb"`, 49 `images.igdb.com` covers, IGDB ratings and IGDB genre codes.
  - **R6 rebuilds it** from Wikidata plus fields we write ourselves, before the public launch (§17.8).
- **Each integration keeps its own check** (`is{Igdb,Steam,Itad,Blizzard,Cooptimus}Configured()`) and gains a relay source. Precedence per column: an admin override beats your own key, which beats the relay, which beats the seed (decision R-6).

| Data | Default source | "Use my own key" placement | Without your own key |
|---|---|---|---|
| Catalogue identity (RL ID, crosswalk, names, aliases) | **Relay** (Wikidata + RL, plus `steam`-provenance Steam IDs, D15) | not applicable | nothing is lost |
| Title, release date, platforms, genres, modes | **Relay** (title from Wikidata or the relay admin; dates, platforms, genres and modes from Wikidata plus the rebuilt seed's RL fields (only values proven hand-written, §17.8)) | An IGDB key overrides per column | Gaps where Wikidata is thin (field coverage UNVERIFIED, §17.4) |
| Covers, summaries, ratings, screenshots, videos | **Your own IGDB key only**, stored locally. ITAD boxart through the relay as a cover fallback if R-12 is approved | "Recommended upgrade", shown up front | Placeholders, no descriptions, no ratings (§17.4) |
| ITAD prices and deals | **Relay** (after R17) | Advanced | nothing is lost |
| Twitch stream counts | Your own IGDB/Twitch client. Never relayed; cached under 24 h | Comes with the IGDB key | Live-stream counts |
| Steam (library, wishlist, playtime, persona) | **This server's own Steam Web API key**; players link their own Steam accounts | Advanced ("Advanced: your own keys") | Library import, wishlist interests, playtime. Steam sign-in (OpenID) works without a key |
| Blizzard (characters, journal and item data) | **This server's Battle.net client** (`client_credentials`), characters imported one at a time | Advanced ("Advanced: your own keys") | WoW character import, boss and loot data |
| Co-Optimus | Off in cloud and through the relay. The prod NAS keeps its single-instance grant; renegotiation is optional and not planned | not applicable | Co-op facts |

- **Visibility is still the gap.** Nothing tells an admin what is missing today, and the onboarding data-sources check covers only blizzard, igdb and discord (`onboarding.controller.ts:273-287`). The wizard's step 6 becomes a "Game data" screen, and admins get a relay status card (§17.10).
- **How this changes the 09-20 addendum's framing.** The addendum's line that "IGDB, Steam and Blizzard stay bring-your-own-key" still holds. What changes is that a zero-key instance no longer needs any of them for a usable catalogue: Wikidata fills that role through the hub, and ITAD adds prices after R17 under the addendum's five conditions.

---

## 8. Updates and backups

**Updates**

| Provider | How an update is applied | Status |
|---|---|---|
| Render | Dashboard "Deploy latest reference", or a deploy hook with `imgURL`. No auto-redeploy on a new image | Verified |
| Railway | Redeploy on a new image | Auto-redeploy UNVERIFIED |
| Fly | `fly deploy --image ghcr.io/…:stable` | UNVERIFIED |

- Migrations already run at boot with a pre-migration dump.
- `UpdateBanner` (ROK-1475) says *that* an update exists. Add a per-provider "How to update" link, with the provider detected by the resolver's `source`.
- **UNVERIFIED:** whether the version check's unauthenticated GitHub API call hits rate limits from a PaaS's shared outbound IPs.

**Backups**
- The daily `pg_dump` runs at 02:00 with 30-day retention into `/data/backups` (`backup.service.ts:98, 29`), on the **same disk** as PGDATA. It is not off-site.
- **Bug (confirmed):**
  - The entrypoint dumps to `/data/backups/migrations/pre_migration_<ts>.dump` on **every boot** (`docker-entrypoint.sh:12-19`).
  - `rotateDailyBackups()` walks only `dailyDir` (`backup.service.ts:138-155`), and nothing else prunes `migrations/`.
  - On a 1 GB Render disk, repeated restarts and deploys eventually fill it.
- **Provider layer:** Render disk snapshots (daily, ≥7 d), Fly volume snapshots (5 d default), Railway volume backups.
- **Fly's single-host volume** makes an off-site copy matter more.
- **The docs must say plainly:** off-site backup is the deployer's job, and here is how to download one from Admin → Backups.
- **Sentry:** a stranger has no Sentry DSN, so a failed migration is only a crash loop in the provider's logs. The "Host your own" page should say where to look.

---

## 9. Security defaults for a stranger's instance

- **Cloud mode refuses** `DEMO_MODE=true` at boot, ignores `FLEET_*`, and hides the demo-data generator. Hiding it while DEMO_MODE is off is still UNVERIFIED.
- **Co-Optimus is hard-off:** no nav entry, the controller returns 404, and the `COOPTIMUS_SYNC_CRON` job is skipped. The Ollama card is hidden.
- **No community seed data.** Only the public game catalogue.
- **Claim window:** 72 h, hashed and single-use (§5).
- **Rate limits collapse onto the proxy IP (bug, likely affects prod).**
  - `main.ts:73` sets `trust proxy` to 1.
  - nginx appends `$remote_addr` to X-Forwarded-For (`monolith.conf.template:76, 90, 123`).
  - So behind *any* proxy, `req.ip` is the edge's IP. That covers Render's edge, Railway, Fly and a NAS reverse proxy.
  - The throttler uses the default `req.ip` tracker (`throttler.module.ts`), so every user shares one 60/min bucket and one 10/min auth bucket.
  - If raid.gamernight.net sits behind a reverse proxy, **prod has this today**; verify.
  - **Fix:** a configurable hop count (`TRUST_PROXY_HOPS`, default 2 in allinone), or nginx `real_ip_header X-Forwarded-For` with `set_real_ip_from` for trusted ranges.
- **`/p/lineup` sends the wrong X-Forwarded-Proto (bug).** It forwards `$scheme` (`monolith.conf.template:124`), so the API sees http behind PaaS TLS. It should use `$proxy_proto`.
- **PORT collision.** A platform injecting `PORT=3000` would collide with the API's pinned internal port (`Dockerfile.allinone:274`). Cloud mode should move the internal port or refuse the conflict.
- **nginx listens on IPv4 only** (`:644`, template `:32`). This needs verifying behind Fly's proxy.
- **Health checks:** templates use `/api/health/ready` for deploy gating and `/api/health/live` for liveness. `render.yaml:7` uses the deprecated `/api/health`.
- **HSTS** is fine behind a TLS-terminating edge.
- **One instance only.** Templates must pin a single instance: boot-time migrations would race, and disks forbid scaling anyway.

---

## 10. Honest costs and limits (for the "Host your own" page)

| Provider | Setup | Est. monthly | Sleeps? | What breaks when idle | Backup story |
|---|---|---|---|---|---|
| **Render** | Standard 2 GB + 5–10 GB disk | **$26.25–27.50** | No (paid plans) | Nothing | Daily disk snapshot ≥7 d + in-app dumps |
| **Railway** | Hobby, usage-billed, 5 GB volume | **$6–12 (est.)** | Opt-in only; the bot's outbound traffic keeps it awake | Nothing, if sleep stays off | Volume backups + in-app dumps |
| **Fly.io** | 1–2 GB shared-cpu + 5 GB volume | **$6.45–11.45** | Only if `auto_stop_machines` isn't pinned off | Bot gateway, cron, reminders | 5-day volume snapshots (single host) + in-app dumps |
| Heroku (not offered) | Split | $70+ | Eco sleeps at 30 min | Everything | Heroku PG backups |
| DigitalOcean (not offered) | Split, hand-built spec | $40–55 | No | n/a | Managed-DB backups |
| Any free tier | n/a | $0 | Yes, or RAM-capped | Won't run it | n/a |

**Arithmetic behind the estimates:**
- **Railway:** the providers lane's $18 assumed 1.5 GB resident. The measured idle is about 0.32 GiB: about $3.50 RAM, $0.40–2 CPU and $0.75 volume, against the $5 Hobby floor. Confirm from Railway's usage meter after 24 h (§13).
- **Fly:** every app gets a shared IPv4 at no charge, which is enough for HTTP(S). A dedicated IPv4 is $2/mo and not needed. Prices are the Ashburn (`iad`) base. Fly's pricing page applies a regional markup, for example 1.25× in Chicago and Dallas and up to 1.30× in Johannesburg, so outside US-East the 2 GB machine alone costs up to about $13.90 (volume markup not checked).
- **Every row** excludes egress, and prices change. Date-stamp the docs page.
- **No Render Starter line** (C3, 2026-09-23). §13 R-1 stays a private experiment.
- **The relay costs a deployer nothing.** The operator pays for it once, for all instances (below).

**Operator-side cost of the relay hub (§17).**

| Item | Recommended | Est. monthly |
|---|---|---|
| Hub compute | Fly shared-cpu-1x **2 GB**, with the hub API and its Postgres in one machine. The crosswalk is about 180k games and roughly 1–1.5M ID and name rows (est.), so 1 GB is tight | $10.70 (1 GB: $5.70) |
| Hub volume | 10 GB at $0.15/GB | $1.50 |
| TLS, DDoS protection and edge cache | Cloudflare free plan. It caches only the public CC0 snapshot; token and price responses are never cached (ITAD condition 3) | $0 (plan limits, including large-file caching, UNVERIFIED) |
| Off-site hub database dump | To the NAS or an object store | about $0–1 |
| Domain | `raid-ledger.com` if the operator owns it (R-1) | about $1–2 amortised (UNVERIFIED) |
| Upstream data | Wikidata is free (CC0; User-Agent policy; 60 s of query time per 60 s). ITAD is free. **The hub has no IGDB client** | $0 |
| **Total** | | **about $12–16/mo (about $8–10 on 1 GB) up to roughly 1,000 instances (est.)** |

- **Load arithmetic (est.):**
  - **First sync:** about 10–20 MB gzipped per instance, served from the Cloudflare cache rather than the machine.
  - **Steady state:** deltas of a few KB. At 1,000 instances, about 0.5 req/s and under 1 GB/mo of origin egress.
  - **Binding limits:** the hub's one-time Wikidata ingest (resumable; Wikidata ran into 502s and a timeout during testing), and ITAD's "don't max out" guidance for prices. Hub CPU isn't one of them.
- **Alternative for a closed beta only:** the Proxmox VM plus a Cloudflare Tunnel, at $0 marginal. Strangers' instances would then depend on the operator's home uplink and power (R-2).
- **Fly prices are Ashburn base,** as in the rows above. Fly egress is not re-checked (UNVERIFIED), but it is pennies at this volume.

---

## 11. Risks
## 11. Risks

1. **Render button with an image Blueprint is unproven.** If the button only takes source builds, Render keeps building from source (slow, spends build minutes) until Render supports it.
2. **The memory figure is a floor.** It was one aarch64 run with no bot and no data. The plan floor could move once steady-state bot memory is measured. The fleet can't show env memory without an `rl status` change (a ROK-1338 umbrella item).
3. **Fly's single-host volume** plus an allinone Postgres risks data loss when the host fails, unless the deployer keeps off-site dumps.
4. **Railway template drift:** the template lives in Railway's UI, so image, env or volume changes won't follow our PRs. It needs a named owner and a runbook step in release cutting.
5. **amd64 only.** Fine for all three recommended providers' default hardware (confirm in §13). An arm64 build would be a separate CI cost.
6. **Support burden.** Strangers will open issues about Discord setup. The wizard's quality decides how many.
7. **Terms drift.** Provider pricing and free tiers change. Heroku's sustaining-engineering status is a live warning.
8. **Claim-code leakage.** Anyone with dashboard access (team members on the deployer's account) can claim. That's acceptable: they already control the instance.

---

## 12. Decisions

**Ruled 2026-09-23.** The operator said "yes to all" and approved every recommended option.

| # | Ruling |
|---|---|
| D-1 / C1 | Render is the default provider. Railway is offered as the middle option and Fly as the budget, CLI-only option. |
| D-2 / C1 | Heroku and DigitalOcean are dropped from one-click, and split topology is deferred (§14 #17 stays deferred). |
| D-3 / C6 | Claim-on-first-visit is cloud-only. The NAS keeps the stdout banner. |
| D-4 | The cloud flavour is a runtime flag (`RL_FLAVOUR=cloud`) on one image. The dead glibc/Ollama donor stage is removed for every flavour, following the §3 lean; flag it if that sub-point wasn't meant. |
| D-5 / C11 | Templates track a moving `:stable` tag cut from releases. |
| D-6 / C2 | The Railway template is published from the operator's account on `:stable`, with a sync step in `/releasing`. |
| D-7 | The design sheets are approved with C3–C12 below. The relay model reopens only the optional-keys ("Keys") sheet (§17.10). |
| C3 | The costs page has no Render Starter line (row removed from §10). §13 R-1 stays as a private experiment. |
| C4 / C5 | The claim is one screen (code plus new password) for the fixed `admin@local`. |
| C7 | The wizard has 7 steps, with "finish later" available once the bot has joined. |
| C8 | The wizard shows an intents checklist and detects the intents on connect. |
| C9 | The default channel is picked in the wizard after "bot joined". |
| C10 | ~~IGDB and Steam up front, with Blizzard and ITAD under "More integrations".~~ **Superseded by the relay model:** the relay covers the catalogue by default, and prices after R17. The "Game data" step (§17.10) shows the relay status first, then IGDB as a recommended upgrade up front. The Steam Web API key, this server's Battle.net client and an own ITAD key all sit under "Advanced: your own keys", as the Keys sheet draws it; players still link Steam and sign in with it without a key. |
| C12 | The update banner becomes a per-provider update card (§14 #15). |

**Ruled 2026-09-23: the relay model (§17).**

| # | Ruling |
|---|---|
| RM-1 | The relay hub is the default data source for new instances. It owns a canonical RL game ID and a crosswalk (RL ID ↔ Wikidata QID ↔ IGDB ↔ Steam ↔ ITAD ↔ normalized name). The cross-reference IDs come from Wikidata (CC0). |
| RM-2 | Instances contribute identity only: ID mappings for games they add, never IGDB content. The name-dedup guard (`withGameNameLock`) maps onto the crosswalk. |
| RM-3 | Hub metadata comes from Wikidata and RL's own seed, never from IGDB. Canonical titles come from Wikidata (`en`, then `mul`) or are typed by the relay admin. The rebuilt seed contributes only fields proven hand-written or Wikidata-derived (§17.8), and its old IGDB names and slugs are match-only and never served. |
| RM-4 | ITAD prices are relayed under the addendum's five conditions, and the hub is registered as its own ITAD app. **This rules R-8 yes.** |
| RM-5 | Local only: IGDB (an optional per-instance upgrade, stored locally), Twitch stream counts, Steam, Blizzard and Co-Optimus (off in cloud; renegotiation not planned). |
| RM-6 | **The IGDB email is ruled out.** It isn't needed under this design. |
| R-8 | ITAD prices through the relay: **yes** (RM-4). They are keyed by the instance's country (default US) and hidden once older than 24 h. How the priced set is chosen is R-17. |
| R-10 | The IGDB seed baked into the image: **rebuild it from Wikidata plus RL fields (R6), unconditionally.** With no email, there is no "ask first" path. It blocks the public announcement (R-9). |
| R-13 | Titles for games Wikidata lacks: **strict** (ROK-1590). A contributed name is used for matching only. The served title comes from Wikidata or is typed by the relay admin (RL-owned); until one of those exists, the game stays quarantined. A contribution with `source: igdb` carries IGDB's own name, so serving it would break RM-3. |
| R-14 | IDs only instances vouch for: **strict** (ROK-1590). Contributed IGDB-only IDs, contributed Twitch IDs and any other contributed ID that neither Wikidata nor ITAD confirms stay hub-internal for matching only, however many instances report them, so everything served traces to Wikidata, ITAD or RL. These IDs come from IGDB API responses on the instances, so serving them would break RM-1 and §17.0 #2. Reporting the mapping to the hub stays sanctioned by RM-2. **Amended by D15 (below):** a Steam app ID contributed with provenance `steam` is served too, and ITAD confirmation alone no longer makes a contributed Steam ID servable. |
| D15 | **Which IDs the hub may serve: "middle ground"** (ruled 2026-09-23; numbered as in `relay-hub-scope-2026-09-23.md` §8, whose milestones M1–M5 are cited here). Unchanged: IGDB stays local; a row is served only once it has a Wikidata (`en`/`mul`) or relay-admin title (R-13); contributed names and R6's legacy IGDB names and slugs are match-only; ITAD data is relayed only under the five conditions (R17, M3). **On a served row the hub may serve:** (1) any ID Wikidata publishes (CC0): the QID, IGDB via P5794/P9043, the Steam app ID via P1733 and ITAD via P12570; (2) a Steam app ID contributed with per-ID provenance `steam`, meaning the instance got it from Steam itself: in M1 that is only its Steam library, wishlist or playtime sync through the Steam Web API. A store URL pasted on Discord or the web is matched to a game through ITAD and any guild member can paste one, so it is tagged `itad` and stays match-only; no instance path does a Steam store lookup (scope §4.5); (3) from M3 only, an ITAD game ID the hub has confirmed with its **own** ITAD lookup under the five conditions. **Never served (match-only):** an IGDB ID or slug known only from a contribution; a Steam app ID an instance learned through IGDB (`external_games` or websites) or of unknown provenance; an ITAD ID an instance contributed that the hub's own lookup hasn't confirmed; any contributed name. **Consequences:** every ID in a contribution carries its provenance (§17.3, §17.7); the hub stores provenance per crosswalk ID and the serving query filters on it (§17.1); the instance records where each Steam ID came from (§17.3, instance side). A `steam`-provenance ID is still a contributor's claim: in M1 prod is the only contributor, and before third-party contributors (M5) one that conflicts with Wikidata's P1733 or with another contributor goes through the conflict and quarantine rules and is not served while in conflict. Amends RM-1, R-14 and R-15. |

**Open: relay decisions.** "Blocking" means the named §17.11 stories can't start until it is answered.

| # | Decision | Recommendation | Blocking |
|---|---|---|---|
| R-1 | **Hub domain.** `DEFAULT_RELAY_URL` is `https://hub.raid-ledger.com` (`relay.service.ts:18`; canary `relay.canary.ts:4`). A public resolver (1.1.1.1) returns GitHub Pages IPs for `raid-ledger.com` with nameservers at `hyp.net` (Hover), and **no record** for `hub.`. Nothing in the repo shows that the operator owns it. | Confirm ownership. If the operator doesn't own it, move both defaults to a host the operator does own **before** default-on ships. Otherwise every instance would register with whoever holds the domain. | R1, R8, R10 |
| R-2 | **Hub hosting.** | An operator-owned Fly 2 GB machine behind Cloudflare, about $12–16/mo (§10). 1 GB (about $8–10) is tight for 180k games plus Postgres. The Proxmox VM plus a Cloudflare Tunnel costs $0 and is acceptable for a closed beta only. | R8 |
| R-3 | **Scope of default-on.** | Every new install, whatever the flavour, starts with the relay on. A migration writes an explicit OFF for existing installs, prod included, and shows an admin prompt; there is no silent flip. | R10 |
| R-4 | **When an instance enrolls.** | After the claim (cloud) or the first admin login (NAS), with an anonymous instance token. An unclaimed instance shouldn't call home before its owner has seen the disclosure; the seed covers the gap. | R10 |
| R-5 | **Heartbeat payload.** | Version, schemaVersion, flavour, cursor and opt-ins only. Today's counts and uptime (`relay.service.ts:276-305`) and the planned `communityName` go behind a "share anonymous usage stats" opt-in that defaults to off. | R3 |
| R-6 | **Which source wins.** | An admin override beats your own key, which beats the relay, which beats the seed, per column. This reverses ROK-1485 §4.6 ("relay wins on canonical"). | R13 |
| R-7 | **How much the instance mirrors.** | The full served crosswalk plus metadata (served rows only, per §17.5; about 178k games, 10–20 MB gzipped, about 100–200 MB in Postgres, est.) goes into a separate `relay_catalog` table. A game enters `games` only when adopted. Alternative: mirror the top ~20k by sitelink count and read through for the rest. That is smaller, but more searches then reach the hub. | R9 |
| R-9 | **Launch gate.** | The Deploy buttons can merge as a beta. The public announcement waits for a working zero-key catalogue (R5 + R9 + R10) **and** the rebuilt seed (R6). Prices (R17) are not part of the gate: they land at step 7 of §17.11, so the design sheets tag every price claim "after R17". | — |
| R-11 | **Where the hub code lives.** | A new `relay/` workspace in this monorepo that shares `packages/contract` (the ROK-1485 Q1 default, reconfirmed). | R3 |
| R-12 | **ITAD boxart as a cover fallback through the relay.** | Yes, under the same five ITAD conditions, with attribution wherever it renders. Boxart is served as ITAD's own URL (`cdn.itad.com`) and hotlinked by instances. The hub and Cloudflare never proxy, mirror or cache the image bytes. Local IGDB images stay hotlinked as they are today. It fills covers for Steam-sold games (70% of Wikidata games carry a Steam ID; 43 of the 49 seed games). Without it, a keyless instance shows placeholders everywhere. | R7 |
| R-15 | **Contribution defaults and trust.** | On by default with an admin toggle. A quorum of 2 established instances (7+ days) makes a mapping usable for matching. The game is served only once it has a Wikidata (`en`/`mul`) or relay-admin title. On a served row only D15's IDs are served: what Wikidata publishes, a Steam app ID contributed with provenance `steam` (not while in conflict), and, from M3, an ITAD ID the hub confirmed with its own lookup. Every other contributed ID, and every contributed name, is never served, however many servers report it (R-13, R-14, D15). The prod NAS is marked verified. | R12 |
| R-16 | **Public catalogue snapshot.** | Yes: the CC0 and RL part is public and edge-cached, with "Data from Wikidata" attribution. ITAD data stays token-only. | R4 |
| R-17 | **Which games get prices.** | The union of games instances have adopted, sent daily and stored unlinked from the token. Alternative: price every Steam-sold game per country. That needs no interest list, but it means hundreds of ITAD calls per country per refresh against ITAD's "don't max out" guidance (batch size UNVERIFIED). | R17 |
| R-18 | **RL vocabulary.** | RL-owned codes for genres, modes and platforms, with a legacy map from IGDB numbers so existing rows and the MMORPG slot layout keep working; the Wikidata sitelink count as the popularity proxy. | R2 |

---

## 13. Throwaway-deploy test plan (the operator runs it once accounts exist)

**Prerequisites:** operator accounts on Render, Railway and Fly; a **test** Discord guild and a fresh Discord application per run (never the prod app); a stopwatch. Delete every service, volume and application afterwards (a few dollars prorated in total). Agents may prepare branch files and read results, but never create accounts or paste credentials.

**Timing points (record each):** **T0** button/CLI start · **T1** form submitted · **T2** `/api/health/ready` 200 · **T3** logged-in admin (today: password from the logs) · **T4** Discord OAuth + bot token saved and validated · **T5** bot in the guild, permission check green.

**Checks for every provider:**
- **(a)** Steady-state RAM after 1 h with the bot connected (provider metrics) and the boot peak.
- **(b)** Disk used after boot.
- **(c)** Restart the service: data, admin and bot settings survive.
- **(d)** Redeploy with a different image tag (`:<sha>` → `:main`): data survives and the migrations log is clean.
- **(e)** `curl -sI https://<app>/ | grep -i content-security-policy` contains `upgrade-insecure-requests`, which proves the edge sends X-Forwarded-Proto `https` (closes the Render and DO X-Forwarded-Proto UNVERIFIED items).
- **(f)** Open a lineup page in two tabs: live updates arrive, and devtools shows `101` on `/api/socket.io`.
- **(g)** Record the provider's public-URL env value verbatim, for the resolver's normalisation table.
- **(h)** Leave it idle 30 min: the bot stays online in Discord.

**Render**
1. **R-1** Deploy today's `render.yaml` (source build, Starter) via "New Blueprint" from main, or the button. Record the build time. Does it OOM at boot or after the bot connects? This is the 512 MB experiment.
2. **R-2** From a throwaway branch with an **image-backed** Blueprint (`runtime: image`, `image.url: ghcr.io/sjdodge123/raid-ledger:main`, `plan: standard`, disk `/data` 5 GB, `envVars` `JWT_SECRET` + `SETUP_CODE` with `generateValue: true`, `healthCheckPath: /api/health/ready`), use the Deploy button URL for that branch. Does the button honour `runtime: image`? Are the generated values visible in the dashboard's env tab?
3. **R-3** Run checks a–h on R-2. Also test "Deploy latest reference" as the update path.

**Railway**
1. **RW-1** New project → service from image `ghcr.io/sjdodge123/raid-ledger:main`, a volume at `/data`, variable `JWT_SECRET=${{secret(64)}}`, and generate a domain.
2. **RW-2** "Generate Template from Project", then deploy the template from a logged-out or second browser to time the stranger's path. Does the template auto-generate the public domain, or does the user have to click it (UNVERIFIED)?
3. **RW-3** Run checks a–h. Push nothing, but change the image tag: does Railway redeploy automatically? Read the usage meter after 24 h to replace the cost estimate.

**Fly.io**
1. **F-1** `fly launch --image ghcr.io/sjdodge123/raid-ledger:main --no-deploy`. Edit `fly.toml`: `[http_service] internal_port = 80`, `auto_stop_machines = "off"`, `min_machines_running = 1`, `[mounts] source="data" destination="/data"`. Then `fly volumes create data --size 5`, `fly secrets set JWT_SECRET=... SETUP_CODE=...`, `fly deploy`.
2. **F-2** 1 GB machine first; 2 GB only if a check fails.
3. **F-3** Confirm (the `<app>.fly.dev` suffix is documented, §16) that the IPv4-only nginx listen is reachable through Fly's proxy.
4. **F-4** Try `fly launch --from <repo URL> --copy-config` against a throwaway branch that carries the `fly.toml`. This is the future "launcher" path. Time it.

**Heroku / DigitalOcean.** Only if D-2 is rejected. As a desk check: in a DO Dev Database console, does `CREATE EXTENSION vector;` work? Is Heroku Premium-0's 50 MB enough for BullMQ?

**Results go back to the spike** as a short appendix: times T0–T5 per provider, RAM, and pass/fail per check.

---

## 14. Proposed story list (not filed; the operator triages)

**Tier notes:**
- Nginx and Dockerfile changes are infra and each gets **its own PR** (CLAUDE.md).
- Claim, auth-adjacent and UI stories are the `standard` tier.
- UI stories wait for the design sheets (D-7, approved 2026-09-23; only the Keys sheet is reopened by §17.10).
- **Relay stories R1–R18 are in §17.11.** The merged, dependency-ordered list there supersedes the "Suggested order" below.

| # | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| 1 | `fix(backup): prune per-boot pre-migration snapshots` | The entrypoint dumps to `backups/migrations/` on every boot and nothing prunes it. Keep the last N (e.g. 10) or 30 days. | none | S |
| 2 | `fix(api): rate limits key on the proxy IP behind any reverse proxy` | `trust proxy 1` plus nginx's appended XFF means `req.ip` is the edge's IP. Make the hop count configurable (or nginx `real_ip`); add a unit test for the tracker. Verify prod exposure. | none | S |
| 3 | `fix(nginx): /p/lineup forwards X-Forwarded-Proto $scheme instead of $proxy_proto` | One-line template fix (`monolith.conf.template:124`). Infra, own PR, allinone build and health check. | none | S |
| 4 | `feat(deploy): platform public-URL resolver for CORS, CLIENT_URL and the Discord callback` | `resolvePlatformPublicUrl` (explicit, Render, Railway, Fly, DO, Heroku) as the lowest-trust anchor. Replace the shell CORS block; log the source at boot. Closes ROK-973 for PaaS. | none (shell part is infra) | M |
| 5 | `chore(ci): publish a moving :stable image tag from releases` | `docker-publish.yml` adds `:stable` on `v*` tags. Document it as the template tag. | D-5 | S |
| 6 | `chore(docker): ship prod-only node_modules in Dockerfile.allinone` | An api-only `--omit=dev`/prune stage; measure before and after (998 MB layer today). Infra, own PR, allinone validation. | none | M |
| 7 | `feat(deploy): cloud runtime flavour (RL_FLAVOUR=cloud)` | Refuse DEMO_MODE, ignore FLEET_*, Co-Optimus hard-off (nav, controller, cron), hide Ollama, nginx 1–2 workers, guard the PORT collision. Optionally drop the glibc donor (D-4). | D-4 | M |
| 8 | `feat(onboarding): claim this Raid Ledger — setup code on first visit` | `SETUP_CODE` env or logged code, hashed and single-use, 72 h expiry, soft global lock. `/claim` screen, `claimRequired` in system status, cloud bootstrap with an unprinted password. Replaces "Secure Account". Adds the one-line relay disclosure (§17.10); a successful claim triggers relay enrollment (R10). | design (D-7), D-3; #2 for per-IP limits | L |
| 9 | `fix(discord): invite URL falls back to the OAuth client id; correct two stale setup strings` | `getClientId()` falls back to the saved OAuth client ID. Fix `discord-bot-invite-panel.tsx:17-18` and `discord-bot.service.ts:211-212`. Trivial tier. | none | S |
| 10 | `feat(onboarding): guided Discord setup wizard` | Screens 3–5 of §6: redirect copy-buttons, live-validated credentials, intents checklist + portal link, invite, wait-for-join + permission check, default channel. Delete the Plugins stub. | design (D-7), #9 | L |
| ~~11~~ | ~~`feat(onboarding): optional integrations screen with explicit degraded state`~~ | **Superseded by R15** (the "Game data" step, §17.10) and R14 (the relay status card). | | |
| 12 | `feat(deploy): image-backed render.yaml Blueprint + Deploy to Render button` | `runtime: image` on `:stable`, `plan: standard`, 5–10 GB disk at `/data`, `generateValue` for JWT_SECRET and SETUP_CODE, `/api/health/ready`, README button. | #4, #5, #8, §13 R-2 | S |
| 13 | `feat(deploy): Railway template + README button` | Template built in Railway's UI (image, volume, `${{secret()}}`), README button, sync runbook in `/releasing`. | #4, #5, #8, D-6, §13 RW | S |
| 14 | `feat(deploy): Fly.io launch config + launcher instructions` | `fly.toml` (internal_port 80, auto_stop off, volume) and copy-paste `fly launch` docs. IPv6 listen fix if F-3 fails. | #4, #5, §13 F | S |
| 15 | `feat(admin): per-provider update card` (C12) | The update banner becomes a card, with the provider detected from the resolver's `source`. It gives Render, Railway, Fly and NAS instructions and shows the relay's 426 "update to keep receiving game data" state (§17.9). | #4 | S |
| 16 | `docs: Host your own Raid Ledger — buttons, honest costs, sleep, backups, TLS` | The §10 table (date-stamped), backup responsibility, custom domains via `PUBLIC_URL`, where to find logs. Absorbs R18 (relay privacy note, own key per provider). | #12–#14, R10 | S |
| 17 | `feat(docker): split topology mode — external Postgres and Redis without the embedded services` | Items a–h in §2 (supervisor gating, URL-probing waits, skip local init, BullMQ TLS/username, pg_dump client version). **Deferred** unless D-2 is rejected. | D-2 | M |

**Not a new story:** add env-container memory to `rl status` (`rl-infra/orchestrator/bin/status:61`). It goes on the ROK-1338 no-SSH umbrella checklist, per its own rule.

**Remaining ROK-1590 deliverables:** the §13 proof deploys and the D-7 design sheets.

**Suggested order:** superseded by the merged, dependency-ordered list in §17.11.

---

## 15. Sources

**Reference key** (reconstructed from the providers lane's ordered source list; all fetched 2026-09-23):
- **Render** (render.com/docs/…): R1 deploy-to-render · R2 blueprint-spec · R3 deploying-an-image · R4 disks · R5 render.com/pricing + compute-plans · R6 free · R7 postgresql-extensions · R8 key-value · R9 environment-variables · R10 websocket
- **Railway** (docs.railway.com/…): RW1 templates/publish-and-share · RW2 templates/create · RW3 reference/volumes · RW4 reference/pricing/plans · RW5 reference/pricing/free-trial · RW6 reference/app-sleeping · RW7 guides/postgresql · RW8 guides/redis · RW9 reference/variables · RW10 networking/public-networking/specs-and-limits · RW11 networking/troubleshooting/application-failed-to-respond
- **Fly.io** (fly.io/docs/…): F1 flyctl/launch · F2 reference/configuration + reference/fly-launch · F3 about/pricing · F4 volumes/overview · F5 about/free-trial · F6 mpg · F7 upstash/redis · F8 machines/runtime-environment · F9 networking/request-headers · F10 fly.io/blog/websockets-and-fly
- **Heroku** (devcenter.heroku.com/articles/…): H1 heroku-button (+ changelog-items/2877) · H2 app-json-schema (+ build-docker-images-heroku-yml) · H3 dynos · H4 heroku.com/pricing · H5 eco-dyno-hours · H6 pgvector-heroku-postgres · H7 heroku-redis · H8 dyno-metadata · H9 http-routing · H10 heroku.com/blog/an-update-on-heroku
- **DigitalOcean** (docs.digitalocean.com/products/…): D1 app-platform/how-to/add-deploy-do-button (+ how-to/manage-databases) · D2 app-platform/reference/app-spec · D3 app-platform/details/limits · D4 app-platform/details/pricing · D5 databases/postgresql/details/supported-extensions · D6 databases/postgresql/details/pricing · D7 databases/valkey/details/pricing · D8 app-platform/how-to/use-environment-variables · D9 docs.digitalocean.com/tutorials/app-deploy-websockets
- **Koyeb:** koyeb.com/docs/reference/volumes

**Repo** (`origin/main` 15f3c7d8f): `render.yaml`, `Dockerfile.allinone`, `nginx/monolith.conf.template`, `nginx/snippets/security-headers.conf`, `api/scripts/{docker-entrypoint.sh,bootstrap-admin.ts}`, `api/src/{main.ts,main.helpers.ts}`, `api/src/{queue/queue.module.ts,redis/redis.module.ts,drizzle/drizzle.module.ts}`, `api/src/backup/backup.service.ts`, `api/src/throttler/*`, `api/src/settings/{client-url.helpers,client-url-seeder.service,settings-bot.helpers,encryption.util}.ts`, `api/src/auth/discord.strategy.ts`, `api/src/discord-bot/*`, `api/src/admin/{onboarding.controller,settings-oauth.helpers}.ts`, `api/src/system/system.controller.ts`, `api/src/version/*`, `api/src/ai/providers/ollama-*.ts`, `web/src/pages/{login-page,admin/admin-setup-wizard}.tsx`, `web/src/components/admin/{DiscordOAuthForm,DiscordBotForm,discord-bot-invite-panel,UpdateBanner}.tsx`, `.github/workflows/{ci,docker-publish}.yml`, `rl-infra/orchestrator/bin/{env-spin,status}`.

**Measurements and checks:** GHCR `ghcr.io/sjdodge123/raid-ledger:main` (amd64, 288 MB compressed; anonymous pull 200 today) · one local idle `rl:test` run (container removed) · fleet `rl_status`, `rl_fleet_health`, `rl_env_inspect` (read-only).

**Prior work:** `docs/spikes/rok-1476-second-deployer-audit.md` · `docs/spikes/rok-1476-provider-terms-addendum.md` · Linear ROK-1590, ROK-1476, ROK-1471, ROK-973, ROK-1475, ROK-1420.

---

## 16. Fact-check 2026-09-23

An adversarial pass tried to refute the ten provider claims the recommendation leans on hardest, using each provider's current official pages. Quotes are verbatim and under 15 words.

**Result:** 10 CONFIRMED, 0 WRONG. Two sub-points remain UNVERIFIABLE from the docs and stay with §13. There were four refinements, already applied above: Fly regional markup, Fly IPv4 cost, Heroku Premium-0 memory, and Railway's Pro volume cap. **The TL;DR recommendation is unchanged.**

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Render web plans: Starter 512 MB $7, Standard `1c-2g` 2 GB $25, and no 1 GB web plan | **CONFIRMED** | render.com/pricing: "1 CPU $25/month 2 GB RAM 1c-2g". render.com/docs/compute-plans lists nothing between 512 MB and 2 GB. |
| 2 | Render disk is $0.25/GB/mo on paid services only; an image-backed service can attach one; single instance; daily snapshots kept at least 7 days | **CONFIRMED** | render.com/pricing: "Persistent disks $0.25 per GB per month". render.com/docs/disks: "attach a persistent disk to a paid Render web service". render.com/blog/deploy-prebuilt-docker-images: image services can "add a persistent disk". |
| 3 | Blueprint supports `runtime: image` + `image.url`, and `generateValue` makes a random 256-bit base64 value | **CONFIRMED** | render.com/docs/blueprint-spec: "a randomized, base64-encoded, 256-bit value". **UNVERIFIABLE:** whether the **Deploy button** honours an image-backed Blueprint. render.com/docs/deploy-to-render is silent on image services, so §13 R-2 stands. |
| 4 | Render image-backed services don't auto-redeploy on a new image; update with "Deploy latest reference" or a deploy hook with `imgURL` | **CONFIRMED** | render.com/docs/deploying-an-image: "do not automatically redeploy whenever a new image is associated". |
| 5 | `RENDER_EXTERNAL_URL` is the full https URL; `PORT` defaults to 10000 | **CONFIRMED** | render.com/docs/environment-variables: "the service's full `onrender.com` URL"; "The default port is `10000`." |
| 6 | No free tier runs the image. Render Free spins down after 15 min and has no disk, and its Postgres expires at 30 days. Railway gives a one-time $5 trial for up to 30 days, then $1/mo, and Free is capped at 0.5 GB. Fly's trial is 2 h or 7 days, and its machines stop after 5 min | **CONFIRMED** | render.com/docs/free: "goes 15 minutes without receiving any inbound traffic". docs.railway.com/reference/pricing/free-trial: "includes a one-time grant of $5". fly.io/docs/about/free-trial: "2 hours of machine runtime or 7 days of access". |
| 7 | Railway usage prices: Hobby $5 including $5 of usage, RAM $10/GB-mo, vCPU $20/mo, volume $0.15/GB-mo, Hobby volume cap 5 GB; outbound traffic keeps a sleep-enabled service awake | **CONFIRMED** | docs.railway.com/reference/pricing/plans: "$10 / GB / month"; "$0.15 / GB / month". docs.railway.com/reference/app-sleeping: "detection of any outbound packets". Refinement: the plans page gives Pro volumes "up to 1 TB". Whether sleep is opt-in by default isn't stated there (**UNVERIFIED**). |
| 8 | A Railway template can use a Docker image source, a volume and `${{secret(len, alphabet)}}`; `RAILWAY_PUBLIC_DOMAIN` is a hostname only | **CONFIRMED** | docs.railway.com/templates/create: "Select the service source (GitHub repo or Docker Image)". docs.railway.com/reference/variables: "of the form `example.up.railway.app`". `secret()` defaults to 32 characters. **UNVERIFIABLE:** whether a deployed template generates the public domain automatically, so §13 RW-2 stands. |
| 9 | Fly: shared-cpu-1x 1 GB $5.70 and 2 GB $10.70, volumes $0.15/GB-mo, `<app>.fly.dev`, no `PORT` injected, no button | **CONFIRMED, with refinements** | fly.io/docs/about/pricing: "1GB … $5.70" and "$0.15/GB per month of provisioned capacity". These are the `iad` base (markup 1.0); the page's `regionMarkups` go up to 1.30×. "Dedicated IPv4 addresses are $2/mo", and a shared IPv4 comes with every app, so the old "IPv4 UNVERIFIED" note is closed. fly.io/docs/networking/custom-domain: "automatically given a `fly.dev` subdomain, based on the app's name", which closes the F-3 suffix question. fly.io/docs/machines/runtime-environment lists no `PORT`. |
| 10 | Drop Heroku and DO. Heroku: Standard-2X 1 GB $50, split stack $70+, URL var only through a CLI labs flag, sustaining engineering since 2026-02-06. DO: no volumes, and the button takes only public repos with Dev Databases | **CONFIRMED** | heroku.com/pricing: Standard-2X "$50", Premium-0 "$15", "50 MB" (fills the old UNVERIFIED). devcenter.heroku.com/articles/dyno-metadata: `heroku labs:enable runtime-dyno-metadata`. heroku.com/blog/an-update-on-heroku, dated 2026-02-06. docs.digitalocean.com/…/details/limits: "App Platform does not support volumes." docs.digitalocean.com/…/add-deploy-do-button: "only supports public repositories and Dev Databases". Heroku's ephemeral filesystem and Eco's 30-min sleep were not re-fetched this pass. |

**Still open after the fact-check:**
- Render Deploy button with an image-backed Blueprint (R-2).
- Railway template domain auto-generation (RW-2).
- Railway auto-redeploy on a new image.
- Whether Railway sleep is opt-in by default.
- X-Forwarded-Proto on Render and DO.
- pgvector on DO Dev Databases.

All of these need a throwaway deploy (§13) or a question to the provider.

---

## 17. Relay hub as the default data source (operator decision 2026-09-23)

> Operator 2026-09-23 (ROK-1590): "I want you to also factor in a relay hub into this design. Thats the direction id like to move instead of requiring all raid ledger instances to provide their own data feeds by default."

**Ruled the same day.** The hub serves **identity, not IGDB content**. It holds a canonical Raid Ledger game ID and a crosswalk whose cross-reference IDs come from Wikidata (CC0); D15 later added Steam app IDs an instance got from Steam itself and, from M3, ITAD IDs the hub confirms with its own lookup. Metadata comes from Wikidata and our own seed, and prices (after R17) come from ITAD under the addendum's five conditions. IGDB, Twitch stream counts, Steam, Blizzard and Co-Optimus stay local to each instance. **No IGDB email** is needed under this design. This section replaces the earlier draft, which waited on IGDB's written permission.

**Where things start.** No hub server exists. `api/src/relay/` is a dormant ROK-273 client: it can register, heartbeat, disconnect and send feedback, but it is off unless `RELAY_ENABLED` is set (`relay.service.ts:152-155`), and nothing outside its module injects it. The ROK-1485 design (`docs/spikes/relay-data-contract.md`) is kept where it fits: the envelope and cursor (§3.1), alias shape (§3.4), instance shapes (§3.6), pull protocol (§4.1), collision rule (§4.3), override ledger (§4.4), token model (§5) and Co-Optimus ruling (§7). §17.12 lists every deviation.

**Evidence.** Wikidata figures are live queries from 2026-09-23 (the Wikidata verification lane). Everything marked "est." is arithmetic, not a measurement.

### 17.0 TL;DR

1. **A fresh instance needs zero data-feed keys.** After the claim it enrolls anonymously, pulls the hub's catalogue, and searches its local mirror first.
2. **The hub owns identity.** It holds an RL game ID mapped to the Wikidata QID, IGDB, Steam, ITAD and Twitch IDs and normalized names. The hub has **no IGDB credentials**, and nothing it serves came from an IGDB API response.
3. **Day one for a keyless instance:**
   - **Searchable:** 178,559 Wikidata video games. Every game has a title; dates, platforms, genres and modes appear where Wikidata has them (per-field coverage not measured, §17.4). 82% carry an IGDB ID and 70% a Steam ID. Our 49-game seed resolves 49/49.
   - **Missing:** covers, summaries, ratings and player counts, unless the admin adds an IGDB key. ITAD boxart can fill covers for Steam-sold games (R-12).
4. **Instances contribute identity only.** For a game the hub lacks, an instance sends the ID mapping and the name, never IGDB content. The hub checks it against Wikidata or ITAD and quarantines anything it can't check. Every contributed ID carries its provenance, and a served row carries only three kinds of ID (D15): what Wikidata publishes, a Steam app ID the instance got from Steam itself, and (from M3) an ITAD ID the hub confirmed with its own lookup. Contributed names, IGDB IDs Wikidata doesn't publish, Steam IDs learned through IGDB or of unknown provenance, ITAD IDs the hub hasn't confirmed itself and contributed Twitch IDs are used for matching inside the hub and never served (R-13, R-14, D15).
5. **The image's seed is IGDB content today** and must be rebuilt from Wikidata before the public launch (R6).
6. **Cost and work.** The hub costs about $12–16/mo on one 2 GB machine. There are 18 relay stories, 3 of them L (§17.11).

### 17.1 Data model: identity, not IGDB content

**What the hub serves, and where each field comes from.**

| Field group | Source | Licence | How it is served |
|---|---|---|---|
| **Identity:** RL game ID (ULID), Wikidata QID, IGDB IDs, Steam app IDs, ITAD slug, Twitch category ID, Battle.net and GOG IDs, served aliases (Wikidata-derived, RL-minted `merge`, or typed by the relay admin), and normalized forms of served titles and aliases only | Wikidata: P9043 (the IGDB number, a qualifier on P5794), P1733, P12570, P4467, P13193, P2725. Plus RL-minted IDs, and a Steam app ID contributed with provenance `steam` (D15: the instance got it from Steam itself; not while in conflict). A Twitch category ID is served only where Wikidata publishes it. Contributed IGDB IDs and slugs Wikidata doesn't publish, contributed Twitch category IDs (on an instance they come from IGDB's `external_games`, `igdb-itad-enrich.helpers.ts:35-51`), contributed Steam app IDs of any other provenance (`igdb`, `itad`, `manual`, `unknown`), contributed ITAD IDs the hub hasn't confirmed with its own lookup, contributed names, `instance_dedup` aliases and any match-only name or slug (R6's legacy IGDB keys) stay hub-internal for matching only (R-13, R-14, D15); an ITAD UUID the hub confirmed with its own lookup travels in the ITAD group below (from M3, §17.3) | CC0, or RL-owned; a `steam`-provenance Steam ID is a contributor's factual claim, served as a bare ID | Public snapshot plus token deltas (§17.5) |
| **Metadata:** title (Wikidata `en`, falling back to `mul`, or typed by the relay admin; never an old seed name, which came from IGDB and is used for matching only), release date P577, platforms P400, genres P136, modes P404, max players P1873 (sparse), a popularity proxy (sitelink count, R-18) | Wikidata, the rebuilt RL seed and relay-admin edits | CC0, or RL-owned | Same |
| **ITAD:** the ITAD game UUID the hub confirmed with its own ITAD lookup (from M3, D15), and prices with shop URLs. A Steam app ID from ITAD's lookup validates a contribution but is served only under the identity row's rule (P1733 or `steam` provenance, D15). The hub caches prices, IDs and, if R-12 is approved, ITAD's boxart URL string (a reference only, no image bytes); nothing else: no tags, early-access flag or other ITAD metadata | The hub's own ITAD app key | ITAD ToS: the addendum's 5 conditions | Token only; never cached at the edge. Boxart is served as ITAD's own URL (`cdn.itad.com`) and hotlinked by instances. The hub and Cloudflare never proxy, mirror or cache the image bytes. Local IGDB images stay hotlinked as they are today |
| **Never served** | IGDB cover, screenshot and video IDs, summaries, IGDB ratings, popularity, genre and theme codes; Twitch stream counts; anything from the Steam or Blizzard APIs except a bare Steam app ID with `steam` provenance (D15); co-op facts | | |

**Guard.** The `relay/` workspace has no IGDB client. A CI source-scanning test fails if `relay/**` mentions `api.igdb.com` or imports `api/src/igdb` (strip comments first, per memory `feedback_source_scanning_guards_strip_comments`).

**Crosswalk schema (hub Postgres).**

```
rl_games       (rl_game_id ULID PK, wikidata_qid UNIQUE NULL, title, title_source, slug UNIQUE,
                status active|quarantined|merged|tombstoned, merged_into, updated_at)
rl_game_ids    (rl_game_id, kind igdb|steam|itad_slug|itad_uuid|twitch|battlenet|gog|…, value,
                is_primary, source wikidata|itad|instance|rl_seed|relay_admin,
                provenance steam|igdb|itad|wikidata|manual|unknown NULL,  -- the contributor's per-ID tag (D15); NULL on hub-sourced rows
                confidence confirmed|corroborated|unverified, first_seen, last_confirmed,
                itad_confirmed_at NULL)  -- M3: set when the hub's own ITAD lookup confirms an itad_uuid
                UNIQUE (kind, value)   -- one external ID names exactly one RL game
                -- served (D15), only on a served rl_games row and only with no open crosswalk_conflicts row on (kind, value):
                --   source = wikidata
                --   OR (kind = steam AND source = instance AND provenance = steam)
                --   OR (kind = itad_uuid AND itad_confirmed_at IS NOT NULL)   -- the hub's own ITAD lookup, from M3
                -- every other row is match-only
rl_game_names  (rl_game_id, normalized_name, display_name, lang en|mul|alias, source, match_only)
                -- NOT unique; match_only rows (R6's legacy IGDB names, contributed names) are never served
rl_game_meta   (rl_game_id, release_date, platforms[], genres[], modes[], max_players,
                sitelinks, source, wikidata_revid)
contributions  (id, token_hash, tier, payload jsonb, verdict, rl_game_id, created_at)
itad_games     (rl_game_id, itad_uuid, steam_app_ids[], boxart_url NULL, updated_at)
                -- IDs, plus ITAD's boxart URL string only if R-12 is approved (a reference, never image bytes); no tags, no early-access flag
crosswalk_conflicts · wikidata_sync_state · itad_prices · price_interest · instances
```

- **One external ID names one game, but a game can have several IDs of one kind.** Each game has one primary ID per kind, and the rest are aliases. Final Fantasy XIV needs this: our seed says IGDB 14729, but Wikidata maps the game to 136224 ("final-fantasy-xiv-online-starter-edition"). Both IDs sit on one RL game, but only 136224 (published by Wikidata) is served. 14729 is not on Wikidata, so it is an `instance_dedup` alias: hub-internal, used for matching only, and never in the snapshot, deltas, search or resolve (a resolve by 14729 answers not-found). A local `games.igdb_id` stays unique, and an instance keeps whichever IGDB ID it already holds.
- **Names are not unique.** "Doom" (1993) and "Doom" (2016) are different games, so a lookup by name alone returns candidates and never picks one.
- **One normalizer.** `normalizeGameName` moves into `packages/contract`, so the hub and the instance's `findGameByNormalizedName` (`igdb-name-dedup.helpers.ts:58`) dedupe identically.
- **Vocabulary.** Genres, modes and platforms become RL-owned codes such as `mmorpg`, not IGDB's numbers. A static legacy map keeps existing rows and the "genre 36 = MMORPG" slot-layout rule working (the seed header; `demo-data-roster.helpers.ts:61`, `demo-data-install-signups.helpers.ts:80`). This is decision R-18.

**Matching order: IDs first, names last.** The Wikidata lane matched 35 of 35 extra titles by ID and search, but only 23 of 35 by exact English title.
1. IGDB number: the P9043 qualifier, never the P5794 slug.
2. Steam app ID.
3. ITAD UUID or slug.
4. Twitch category ID.
5. QID.
6. Normalized name across `en`, `mul` and the aliases.

A match on name alone never merges anything automatically.

**Conflicts and merges.**

| Case | Rule |
|---|---|
| **Two instances map different IGDB IDs to one name** | IDs beat names, and each IGDB ID is its own key. If Wikidata, or a shared second ID such as the Steam app ID, ties both to one QID, the second IGDB ID becomes an alias (reason `instance_dedup`). An `instance_dedup` alias is hub-internal: it is used for matching only and never served (not in the snapshot, deltas, search or resolve). Otherwise the two RL games share a name and a conflict row goes to the relay-admin queue. FFXIV is the first case: our 14729 arrives with Steam 39210, which Wikidata puts on the QID that carries 136224. |
| **An instance's mapping disagrees with Wikidata** | Wikidata wins by default. If three or more established instances disagree, a relay-admin review opens. The fix may be an ordinary manual Wikidata edit. |
| **A `steam`-provenance Steam ID disagrees with Wikidata's P1733 or with another contributor** (D15) | It is a contributor's claim, so the rules above apply: a `crosswalk_conflicts` row, the ID stays match-only and is not served while the conflict is open, and Wikidata wins by default. In M1 prod is the only contributor; the check must be live before third-party contributors (M5). |
| **A game is renamed** | The RL ID doesn't change. The title follows Wikidata's label at the next sync, and the old normalized name stays as an alias, so local name-dedup still finds the game. The instance applies the new title unless an admin has overridden it (`game_field_overrides`, ROK-1485 §4.4). |
| **Two RL IDs turn out to be one game** (two contributions arrived before a QID existed, or Wikidata merged two items) | The hub merges them: the loser gets `merged_into`, and aliases are emitted with reason `merge`. Instances follow ROK-1485 §4.3 step 6: they mark the local row and never delete it. |
| **A Wikidata edit re-points an ID that instances already use** | It is held for 7 days in the review queue before it propagates. This guards against vandalism. |
| **Wikidata doesn't have the game** | The RL ID is minted from contributions and stays `quarantined` (§17.3). Contributed names, IGDB-only IDs and other contributed IDs D15 doesn't allow (Twitch included) are used for matching only. The game is served once Wikidata has it or the relay admin types its title (RL-owned): decision R-13. On that served row a `steam`-provenance Steam ID is served too and, from M3, an ITAD UUID the hub confirmed itself (D15). |

### 17.2 How the hub ingests Wikidata

- **Initial load.** Paged SPARQL over P31 = Q7889 (178,559 items).
  - Items with P5794 or P1733 that aren't typed as video games are left out (7,588 editions, bundles and DLC). They are added only when an instance references one.
  - The hub sends a descriptive User-Agent with a contact address, because the policy says non-compliant clients "may be blocked completely".
  - It runs one query at a time and honours `Retry-After` on 429.
  - The load must resume page by page: the lane hit three 502s and one 90 s timeout in about 20 queries.
- **Titles.** Use `en` and fall back to `mul`. 15 of our 48 matched seed games have only a `mul` title, including Baldur's Gate 3, Elden Ring, Helldivers 2 and CS2.
- **Updates.**
  - **Edits:** EventStreams recent changes, filtered to known QIDs, followed by a fetch of `Special:EntityData/<QID>.json` for each changed item.
  - **New items:** a weekly SPARQL sweep on `schema:dateModified`.
  - **Full rebuild:** the weekly JSON dump (over 130 GiB). It is processed off the hub, never on a 2 GB machine.
- **ITAD IDs need one more step.** Wikidata's P12570 holds ITAD's page slug, not the UUID the API uses. The hub resolves UUIDs through ITAD's lookup endpoints, which the repo already calls (`/games/lookup/v1`; the Steam shop lookup at `itad.constants.ts:61-66`). Whether a slug alone resolves is **UNVERIFIED**, so Steam app ID is the dependable key. In the seed that covers 43 of 49 games; the six not sold on Steam have no ITAD entry anyway.
- **Attribution.** Wikidata asks users to "mention Wikidata as the origin of your data". Every instance's game pages and the hub's docs say "Data from Wikidata" (R16), without the logo.

### 17.3 Contributions: instances report identity, the hub validates

**The flow.**
1. **An instance adds a game:** by searching IGDB with its own key, through Steam discovery, or manually by name.
   - Inside `withGameNameLock` it checks the local `games` rows, then its mirror (§17.5), by ID first and then by name.
   - If the mirror has the game, the instance sets `games.relay_game_id` and **sends nothing**.
2. **On a mirror miss,** after the lock returns (success callbacks never fire inside it), the instance writes an outbox row: `{ ids: {igdb?, steam?, itadUuid?, twitch?}, name, normalizedName, source: igdb|steam|manual }`, where each ID is `{ value, provenance }` with provenance `steam|igdb|itad|wikidata|manual|unknown` (D15), and no Steam-ownership or Co-Optimus flag is sent (relay-hub scope §4.5). `source` says how the game was added; `provenance` says where each ID came from, and only `provenance` decides what can be served. It never includes a summary, cover, genre, rating or any other field. The `twitch` ID comes from IGDB's `external_games` (`igdb-itad-enrich.helpers.ts:35-51`), so the hub treats it exactly like an IGDB-only ID: hub-internal, for matching only, never served (R-14). The same holds for any contributed ID D15 doesn't allow: an IGDB ID Wikidata doesn't publish, a Steam ID whose provenance isn't `steam`, and an ITAD ID the hub hasn't confirmed with its own lookup.
3. **The outbox is sent in the 6-hourly sync window.** It is batched for the whole instance, capped at 50 per window and de-duplicated, so the hub can't tell which user or action caused an entry.
4. **The hub gives each item a verdict:**

| Verdict | When | Result |
|---|---|---|
| `confirmed_by_wikidata` | The IDs match a QID | The existing RL ID is returned; the contribution adds nothing new |
| `confirmed_by_itad` | A Steam app ID with no QID, which ITAD's lookup finds with a title that normalizes to the contributed name | An RL ID is minted and its Steam and ITAD IDs count as confirmed for matching. ITAD's title is used only to validate, never stored as the title. The game stays quarantined until it has a Wikidata or relay-admin title (R-13). Once served, it carries the ITAD UUID from the hub's own lookup (from M3) and the Steam ID only if its provenance is `steam`; ITAD confirmation doesn't make an `igdb` or `unknown` Steam ID servable (D15) |
| `corroborated` | A mapping the hub can't check (IGDB-only, Twitch-only, name-only, or any contributed ID that neither Wikidata nor ITAD confirms) that two established instances (distinct tokens and /24s) sent identically | The mapping becomes active for matching inside the hub, so every contributor gets the same RL ID. The unconfirmed IDs and the name are never served, however many instances send them: the game stays quarantined and is served only once it has a Wikidata (`en`/`mul`) or relay-admin title. Even then, only D15's IDs are served: what Wikidata publishes, a `steam`-provenance Steam ID and, from M3, an ITAD UUID the hub confirmed itself (R-13, R-14, D15) |
| `quarantined` | The first sighting of a mapping the hub can't check | An RL ID is returned to that contributor only and not fanned out |
| `conflict` / `rejected` | It contradicts Wikidata or a confirmed mapping, or it is malformed. A `steam`-provenance Steam ID that disagrees with Wikidata's P1733 or with another contributor lands here (D15) | A conflict row; nothing is written, and the disputed ID is not served while the conflict is open |

5. **The instance applies the returned RL ID** using the ROK-1485 §4.3 collision rule.

**Trust tiers** (decision R-15).

| Tier | Who | Weight |
|---|---|---|
| new | Token younger than 7 days | Stored; doesn't count toward the quorum |
| established | 7 or more days of continuous heartbeats | Counts toward the quorum of 2 |
| verified | Marked by the relay admin (the prod NAS, known communities) | Its single report makes a mapping the hub can't check active for matching, if nothing contradicts it. That still doesn't make it served (R-14) |

A mapping Wikidata confirms applies whatever the contributor's tier.

**Abuse handling.**
- **Rate limits:** 50 contributions per window and 200 a day per token.
- **Name checks:** 1–200 printable characters, no URLs.
- **No titles from contributions:** a contributed name is used for matching only; a served title comes from Wikidata or the relay admin (R-13).
- **Rollback:** every contribution is stored with its token hash, so `relay-admin rollback <instanceId>` reverts every unconfirmed mapping from that instance. `relay-admin revoke` plus the denylist stays as the last step.

**An instance with its own IGDB key enriches locally and stays on the shared IDs.**
- Its IGDB cron enriches local rows by the IGDB ID the crosswalk supplies, which comes from Wikidata for 82% of games. Covers, summaries, ratings and screenshots are stored locally, which is permitted, and never sent anywhere.
- Precedence per column (R-6): an admin override beats your own key, which beats the relay, which beats the seed. Identity always comes from the crosswalk, so an instance with a key and one without point at the same RL game.
- When the hub later sets a different primary IGDB ID (the FFXIV case), the instance keeps its own local `igdb_id` for its cron. The RL ID is the join key, not the IGDB ID.

**Instance side: where each Steam ID's provenance comes from (D15).** Nothing records it today, and the relay client sends no game mappings at all: `api/src/relay/relay.service.ts` sends register, heartbeat, feedback and disconnect only, and nothing in `api/src/relay/` references `steam_app_id`, `itad_game_id` or game rows. The contribution builder is new code. The trace at `origin/main`, all paths under `api/src`:
- **Who writes `games.steam_app_id`** (`drizzle/schema/games.ts:54`):
  - **IGDB** (`external_games`, Steam category): the single upsert (`igdb/igdb.mappers.ts:22-28,113` → `igdb/igdb-upsert.helpers.ts:60-66`, `row.steamAppId ?? existing` at `igdb-upsert-sets.helpers.ts:35`), the batch upsert (`igdb-upsert.helpers.ts:265-268`, `COALESCE(excluded.steam_app_id, existing)` at `igdb-upsert-sets.helpers.ts:60`) and `applyIgdbMergeToRow` (`igdb-upsert.helpers.ts:170-177`). IGDB wins whenever it has a value, so these **overwrite** a Steam- or ITAD-written ID.
  - **ITAD:** `games-lookup/games-lookup.service.ts:110-117` and `:130-136` (the Steam ID from `itadService.lookupSteamAppIds`, `:87-90`).
  - **Steam:** `steam/steam-itad-discovery.helpers.ts:45-57`, `:175-183` and `:241-245`, with the appid from Steam's GetOwnedGames (`steam/steam.service.ts:111`) or the Steam wishlist (`steam/steam-wishlist.service.ts:150`). The other two callers take an integer someone else supplies: a Steam store URL any guild member pasted (`discord-bot/listeners/steam-link-interest.helpers.ts:165`) and `GET /games/by-steam-id/:steamAppId` (`igdb/igdb.controller.ts:172` → `igdb/igdb-game-lookup.helpers.ts:114`). Both are tagged `itad` (ITAD only confirms the app exists), which is match-only like `unknown`.
  - **Inherited or hand-set:** the dedup carry (`igdb/igdb-dedup-cleanup.helpers.ts:298-321`) copies the losing row's value into a NULL on the winner; the DEMO_MODE fixtures (`admin/demo-test-steam.helpers.ts:49-50`, `admin/demo-test-cooptimus.helpers.ts:65`); and migration `0156_fix_bad_steam_app_ids.sql`, which hand-corrected four IDs IGDB had got wrong (7 Days to Die was 730). The seed writes none.
- **The ID is last-writer-wins** between IGDB and Steam discovery, and nothing says which wrote last: no source column, no audit row, and `DiscoveryResult.source` (`steam-itad-discovery.helpers.ts:38-42`) is returned but never saved. Inference is weak:
  - `igdb_id IS NULL AND steam_app_id IS NOT NULL` marks a Steam- or ITAD-born row. It is the only strong signal.
  - A `steam_library` or `steam_wishlist` interest row is circular: it is derived from `steam_app_id` (`steam.service.ts:221-228`), so in the 0156 case every Counter-Strike owner "owned" 7 Days to Die. DEMO_MODE also fabricates such rows.
  - `cooptimus_extras.steamAppId` is an independent Steam ID where it exists: corroboration, not provenance.
- **Recommended change (the middle option).**
  1. One column, `games.steam_app_id_source varchar(16) NULL`: `steam | itad | igdb | manual`, with NULL meaning unknown.
  2. A BEFORE INSERT/UPDATE trigger in the same migration NULLs the source whenever `steam_app_id` changes and the statement didn't also set the source, so a path nobody tagged can never leave a stale tag.
  3. Tag the four path families that write non-null IDs: IGDB (`igdb.mappers.ts:113`, plus a CASE at `igdb-upsert-sets.helpers.ts:35` and `:60` that writes `igdb` only when IGDB's value differs from the stored one, so an agreeing sync keeps a `steam` tag), ITAD (`games-lookup.service.ts:115` and `:133`), Steam (`steam-itad-discovery.helpers.ts:52` and `:178`, with the caller passing `steam`, or `itad` for the pasted-URL and by-steam-id routes) and the carry (`igdb-dedup-cleanup.helpers.ts:315-321` copies the loser's source with its value). The demo fixtures stay NULL through the trigger.
  4. No ITAD source column. `itad_game_id` always comes from ITAD, looked up by the stored Steam ID or in reverse, so the contribution always tags it `itad`, whatever the Steam ID's tag. Under D15 a contributed ITAD ID is match-only until the hub's own lookup confirms it anyway.
  5. A SQL-only backfill in the same migration (self-contained): a row with `igdb_id IS NULL AND steam_app_id IS NOT NULL` stays NULL even with a Steam interest row (circular, above: an ITAD-created row gets one too); the four 0156 rows (name plus corrected ID) become `manual`; everything else stays NULL. An honest "unknown" beats guessing `igdb`.
  6. At contribution time the tag maps to the wire provenance (`steam`→`steam`, `itad`→`itad`, `igdb`→`igdb`, `manual`→`manual`, NULL→`unknown`); no corroboration flag is sent (relay-hub scope §4.5). Only `steam` makes the Steam ID servable (D15).
  - **Cost:** one migration (column, trigger, backfill) and about 5 source files plus specs. It is standard tier because of the migration: a `--full` gate and `fix-migration-order.sh --check`, in about 2 lanes (schema, migration and trigger; then wiring and tests). It rides in R12.
  - **Rejected:** a source column set on every path (about 12 files plus a migration, and any future writer that forgets it leaves a wrong tag), and flags only with no schema change (evidence, not provenance: circular in the 0156 case, blind to IGDB overwrites, fabricated on DEMO_MODE).
  - **Follow-up to file separately:** IGDB overwrites Steam- and ITAD-sourced IDs (`igdb-upsert-sets.helpers.ts:35` and `:60`, `applyIgdbMergeToRow`). That contradicts the "ITAD owns the Steam app ID mapping" rule at `igdb-itad-merge.helpers.ts:82-84` and is how the 0156 bad IDs got in. With the tag in place, "never let `igdb` replace `steam` or `itad`" becomes a small precedence fix.

### 17.4 What a keyless instance sees on day one

| Measure | Value |
|---|---|
| Games searchable locally after the first sync | **178,559** (Wikidata items typed as video game) |
| …with an IGDB ID, so an admin's own key can enrich them | 145,820 (**82%**) |
| …with a Steam ID, for Steam library matching and ITAD prices (after R17) | 124,559 (**70%**) |
| …with both | 113,312 (63%) |
| Our 49-game seed resolved to a QID | **49/49** (48 by IGDB number; FFXIV through Steam 39210) |
| Seed games with Steam and ITAD IDs | 43/49. The six not on Steam: WoW, WoW Classic, LoL, VALORANT, Minecraft, Fortnite |
| Seed games with no English title on Wikidata (`mul` fallback) | 15/48 |
| Per-field coverage of date, platform, genre and mode | **Not measured (UNVERIFIED).** The lane reports them present "with some caveats" |

**How the UI degrades.**

| Missing | Behaviour |
|---|---|
| **Covers** | The existing `CoverPlaceholder` (`DrawerCard.tsx:54`). Only `GameBanner.tsx:76` falls back to `coverUrl ?? itadBoxartUrl` today; R14 moves that into one shared helper for every card. With R-12, ITAD boxart, hotlinked from ITAD's own URL, fills the Steam-sold games |
| **Summaries** | The description block is hidden rather than showing "No description". Admins see one hint: "Add an IGDB key for descriptions and covers" |
| **Ratings, IGDB popularity** | Rating badges are hidden. "Popular" sorting uses the Wikidata sitelink count (R-18), then local community interest |
| **Player counts** | Sparse on Wikidata. Player-count filters show "unknown", and the admin can set a value per game |
| **Genres, modes, platforms** | From Wikidata, mapped to RL codes. Filters work where the data exists |
| **Twitch stream counts** | Hidden |
| **Prices** | Shown once R17 lands, with ITAD attribution as a link. Until then the design sheets tag every price claim "after R17" |

**Mirror size (est.).** About 60–90 MB raw and 10–20 MB gzipped for the first sync, and about 100–200 MB in the instance's Postgres with indexes. That fits the 5–10 GB disks in §10. If the operator wants it smaller, R-7 has an alternative.

### 17.5 Hub architecture and sync model

- **Code:** a new `relay/` workspace (NestJS, Drizzle, Postgres; R-11) that shares `packages/contract/src/relay/`, publishes `ghcr.io/sjdodge123/raid-ledger-relay` and passes the same CI gates.
- **Where it runs:** operator-owned, on one machine with the API and its Postgres in one container (R-2). Cloudflare sits in front for TLS and DDoS protection, and edge-caches the public snapshot only.
- **Sync model: instances pull, and read through to the hub on a miss. The hub never pushes,** because instances sit behind NAT and this data changes weekly.

| Channel | Auth | Content | Cadence |
|---|---|---|---|
| **Snapshot** | **Public**, edge-cached (R-16) | A static `catalog-<epoch>-<date>.ndjson.gz` with served CC0 and RL rows only (RL includes D15's `steam`-provenance Steam IDs; each ID keeps its source tag): never a quarantined game, a contributed name, a contributed ID D15 doesn't allow (an IGDB ID Wikidata doesn't publish, a Steam ID whose provenance isn't `steam` or that is in conflict, an ITAD ID the hub hasn't confirmed itself; Twitch included), an `instance_dedup` alias, or a match-only name or slug (R6's legacy IGDB keys). It ends in a cursor | Rebuilt weekly; an instance fetches it once, or after an epoch change |
| **Deltas** | Token | The ROK-1485 §4.1 cursor feed from the snapshot's cursor: identity, metadata, served aliases (Wikidata-derived, RL-minted `merge` or relay-admin), merges and tombstones; never a quarantined game, a contributed name, a contributed ID D15 doesn't allow (Twitch included), an `instance_dedup` alias, or a match-only name or slug (R6's legacy IGDB keys). Idempotent upserts; the cursor is saved after the writes commit | Every 6 h |
| **ITAD field group** | Token, never edge-cached | `GET /api/v1/itad/changes?since=` (the UUID the hub confirmed with its own ITAD lookup, from M3 (D15), and boxart as ITAD's own URL string only if R-12 is approved; no tags or early-access flag; Steam IDs travel in the identity group under D15's rule) and `GET /api/v1/prices?country=&since=` | Every 6 h |
| **Read-through** | Token | `GET /catalog/search?q=` and `POST /catalog/resolve {kind, value}` when the mirror misses. The hub answers from its own database, then runs a live Wikidata search for items newer than the last delta. It never returns a raw upstream response. Both return only served rows: never a quarantined game, a contributed name, a contributed ID D15 doesn't allow (Twitch included), an `instance_dedup` alias, or a match-only name or slug (R6's legacy IGDB keys), and never a mapping that rests only on such IDs. A resolve by an ID D15 doesn't allow answers not-found, exactly as for an unknown ID. Misses feed an aggregated gap counter | On a miss |
| **Contributions** | Token | The outbox from §17.3 | Every 6 h |

- **Where the mirror lands on the instance** (deviation from ROK-1485 §4.2–4.3, which synced straight into `games`):
  - **Mirror table.** The mirror goes into a new local `relay_catalog` table.
  - **Adoption.** A game enters `games` only when the community uses it: search-and-add, an event, an interest, a lineup or a library match. Adoption runs in `withGameNameLock` with the §4.3 collision rule. It is a new games INSERT path, so append it to memory `reference_games_insert_paths`.
  - **Updates.** Adopted rows then take metadata from each delta.
  - **Why not `games` directly.** 178k rows would otherwise land in `games`, which carries FKs, taste vectors and discover queries.
- **`catalogEpoch`** comes back in every heartbeat response. If the hub database is rebuilt, instances refetch the snapshot and re-match adopted rows by external ID (ROK-1485 §4.3 step 2). A daily off-site dump keeps that a last resort.
- **Prices** (R17; the priced set is decision R-17).
  - **What gets priced.** The hub prices only games some instance has adopted. Once a day, each instance sends `POST /prices/interest {rlGameIds}`.
  - **What the hub keeps.** It stores only the union of those lists with a last-seen date, not linked to the token.
  - **Refresh.** Prices for each active country are refreshed every 6 h. The instance pulls the deltas for its own country and hides any price older than 24 h.

### 17.6 Enrollment, auth and limits

**Enrollment.** An **anonymous instance token**, minted by the open `POST /instances/register` after the claim (cloud) or the first admin login (NAS) (R-4). The hub has no human account and no email.
- **Carried over from ROK-1485 §5:** an opaque bearer token. The hub stores only its hash, and rotation keeps the old token valid for 1 h.
- **Why anonymous:** catalogue reads are read-only and low-value, and a human approval step would add exactly the friction this spike removes. Contributions are covered by the trust tiers in §17.3, not by enrollment.

**Rate limits.** These are starting points, per token unless noted.

| Endpoint | Limit |
|---|---|
| register | 5/h per source IP; 1,000/day globally, with an alert |
| heartbeat | 4/h |
| snapshot | none (static, edge-cached) |
| deltas, ITAD changes | 120/h |
| search / resolve | 30/min and 500/day, with a 3-character minimum. One hub-wide bucket also keeps Wikidata and ITAD calls within their limits |
| contributions | 50 per window, 200/day |
| prices, price interest | 60/h; interest once a day |

**Abuse and revocation.**
- Tokens with no heartbeat for 30 days expire.
- Registrations that never heartbeat within 24 h are pruned.
- `relay-admin revoke <instanceId>` plus a denylist: a revoked instance gets a 401 with a reason and carries on from its mirror.
- **Per-source kill switch:** `DISABLE_SOURCE_ITAD` on the hub stops the ITAD field group and sends tombstones, which is how a revocation reaches every instance.

**Versioning.**
- `/api/v1` carries the major version, and every envelope carries `schemaVersion`.
- Changes are additive only, and readers treat unknown enum values as `unknown` (ROK-1485 §3).
- The hub serves the current and previous `schemaVersion`. Anything older gets a 426, and the instance shows "Update Raid Ledger to keep receiving game data" while its mirror keeps working.
- **Prerequisites:**
  - Fix the hardcoded `APP_VERSION='0.0.1'` (`relay.service.ts:19`).
  - Add a CI golden-page test: pages saved at N-1 must parse at N.

### 17.7 Privacy: exactly what an instance sends

| Call | Sends | When |
|---|---|---|
| register | Random `instanceId` (a UUID, `relay.service.ts:163-175`), app version, `schemaVersion`, flavour and opt-ins | Once, after the claim |
| heartbeat | The same, plus `catalogCursor` and the last sync error code. Counts and `communityName` only under a separate stats opt-in (R-5) | Hourly |
| snapshot, deltas | Nothing but the cursor | Weekly / every 6 h |
| search / resolve | One query string or one external ID. Nothing about who typed it | On a mirror miss |
| **contributions** | **ID mappings plus the name, for games the hub didn't have.** Each ID carries its provenance (`steam`, `igdb`, `itad`, `wikidata`, `manual` or `unknown`, D15); no Steam-ownership or Co-Optimus flag is sent (both stay local, relay-hub scope §4.5). Never who added them, when, or why | Batched every 6 h |
| price interest | The RL IDs the community has adopted, which the hub keeps only as an unlinked union (R-17) | Daily |
| prices | Country code and cursor | Every 6 h |

**Never sent:** user IDs, Discord IDs, usernames, emails, SteamIDs, libraries, characters, events, lineups, message content, any end user's IP, and any IGDB field beyond the ID and the game's name, which the hub uses for matching only and never serves. A provenance tag names only the source of an ID (Steam, IGDB, ITAD, Wikidata, manual), never the user, account or sync that produced it.

**Changes to current code.** Today's heartbeat sends player, event and game counts plus uptime (`relay.service.ts:276-305`). With the relay on by default, those move behind an opt-in (R-5).

**Steam library caveat.** Steam discovery (`steam-itad-discovery.helpers.ts`) resolves a user's owned app IDs against the **local mirror**, which holds 70% of Wikidata games' Steam IDs. Misses never go out as one user's list. Only games that are actually adopted produce contributions, through the instance-wide batch. Their Steam IDs go out with provenance `steam`, so the hub may serve them on a served row (D15).

**Hub logs.**
- **Access log:** method, path **without the query string**, status, latency, a token-hash prefix, and the IP truncated to /24 (IPv4) or /48 (IPv6). Kept 14 days.
- **Gap counter:** normalized query → count, kept 30 days.
- **Nothing else:** no cookies, no analytics, no third-party trackers.

The claim screen links to a short published privacy note (R18).

### 17.8 Licensing

| Source | Through the hub | Conditions |
|---|---|---|
| **Wikidata** (identity, metadata) | **Yes** | CC0: "made available under the Creative Commons CC0 License". Attribution is requested, not required; show "Data from Wikidata" and don't use the logo to suggest endorsement. Follow the query-service User-Agent policy |
| **Raid Ledger-owned** (RL IDs, RL-minted slugs, titles typed by the relay admin, the rebuilt seed's proven hand-written fields, and aliases that are Wikidata-derived, RL-minted `merge` or relay-admin; never `instance_dedup` aliases, contributed names or old IGDB names) | **Yes** | None |
| **ITAD** (the UUID the hub confirmed with its own lookup, from M3 (D15), prices with shop URLs and, if R-12 is approved, the boxart URL string) | **Yes**, under the addendum §3's five conditions | (1) shop URLs byte-for-byte, affiliate tags included, from hub to instance to browser, enforced by a golden-file byte-equality test; (2) ITAD attribution, as a real link to `https://isthereanydeal.com/`, on **every** instance where prices, deals or boxart render; (3) the hub is never a deals site: no public price endpoint, no edge caching of price responses, no price browser; (4) no impression of affiliation in naming or docs: source lines read "Through the Raid Ledger relay · data from IsThereAnyDeal", never a co-branded name; (5) clean degradation: the kill switch tombstones the ITAD group and instances fall back to "no prices", exactly as when `isItadConfigured()` is false, and the admin card shows it (the relay card sheet's `pricesRevoked` state). Boxart passes through as ITAD's own URL: the hub and Cloudflare never proxy, mirror or cache image bytes. **Register the hub as its own app** at `https://isthereanydeal.com/apps/`, describing the redistribution |
| **IGDB** | **Never** | Twitch DSA §V.C bans re-distribution. It stays an optional per-instance key, stored locally. **No email** (ruled 2026-09-23). Only bare IGDB IDs that Wikidata publishes are served. Contributed IGDB-only IDs, and contributed Twitch IDs (which instances take from IGDB's `external_games`), stay hub-internal for matching (R-14), and so does a Steam app ID an instance learned through IGDB (`external_games` or websites; D15), so nothing served came from an IGDB API response |
| **Twitch stream counts** | **Never** | Under 24 h cache, no third-party sharing. Local only, with the instance's own client |
| **Steam** | **Never** | Per-user linking plus a per-instance key. Only Steam app IDs from Wikidata (P1733), or contributed with provenance `steam` (the instance got the ID from Steam itself: library, wishlist or playtime sync; a pasted store URL is matched through ITAD and tagged `itad`), cross the hub, as bare IDs: never names, libraries or any other Steam API field, and not while in conflict (D15). ITAD confirmation alone doesn't make a contributed Steam ID servable |
| **Blizzard** | **Never** | An instance-level Battle.net client (`client_credentials`, `blizzard-auth.service.ts:45`), not per player; BYO key; characters imported one at a time; 30-day TTL |
| **Co-Optimus** | **Never** | Off in cloud. The prod NAS keeps its single-instance grant. Renegotiation is optional and not planned |

**Finding (confirmed by the Wikidata lane): the image ships IGDB content today.**
- **What's in it:** `api/seeds/games-seed.json` declares `"source": "igdb"`. All 49 covers point to `images.igdb.com`, and the file holds IGDB ratings, aggregated ratings, popularity, summaries and IGDB's own genre, mode, theme and platform codes.
- **How it stays current:** `api/scripts/refresh-game-covers.ts` and `api/scripts/lookup-igdb-ids.ts`, both of which call `api.igdb.com/v4/games`.
- **Why it matters:** handing that image to strangers is the redistribution this model avoids, so R6 is **unconditional** under the no-email ruling.
- **The rebuild:**
  - Keep the IGDB, Steam and Twitch IDs only where Wikidata's crosswalk publishes them.
  - Served titles come from Wikidata's `en` label, falling back to `mul`, or are typed by the relay admin; slugs are RL-minted from the served title.
  - Today's names and slugs came from IGDB API responses. R6 writes them to a hub-only legacy matching-keys file, each marked match-only, alongside the Wikidata/RL image seed. R4 imports that file into `rl_game_names` as never-served matching keys. They don't ship in the image and are never served.
  - Re-derive dates, platforms, genres and modes from Wikidata into RL codes.
  - Drop the covers, summaries, ratings, popularity, screenshots, videos and themes.
  - Retire both scripts, or repoint them at Wikidata.
- **Unknown:** whether any field, such as the 17 `crossplay` values or `playerCount`, was written by hand (**UNVERIFIED**). Default: drop any field not proven to be hand-written or Wikidata-derived; only a value proven hand-written stays as an RL-owned field.

### 17.9 Failure modes

| Situation | Instance behaviour | What the admin or user sees |
|---|---|---|
| Hub unreachable at enrollment | Runs on the rebuilt 49-row seed and retries with backoff (capped at 1 h) | Game data card: amber "Relay unreachable, retrying" |
| Hub down after a sync | Serves its mirror (reads never depend on the hub). Search misses use the admin's own IGDB key if there is one | Admin card shows the last sync and the error; a one-line hint in add-game search |
| Wikidata slow or down (hub side) | Nothing changes for instances. The hub serves its last good data, and ingest resumes page by page | Hub alert only |
| Wikidata vandalism re-points an ID in use | The 7-day review hold (§17.1) stops it propagating | Nothing |
| A bad or malicious contribution | Quarantined; corroboration only makes it usable for matching, never served (R-14). The exception is a `steam`-provenance Steam ID on a served row (D15): it is served unless it conflicts with Wikidata's P1733 or another contributor, so the conflict check must be live before third-party contributors (M5). All of it is reversible with `relay-admin rollback` | Nothing, or a conflict row in the instance's dedup audit |
| A crosswalk conflict with a local duplicate | `relay_sync_conflicts` row, no write (ROK-1485 §4.3 step 3) | The ROK-1270 dedup audit |
| Prices older than 24 h | Hidden rather than shown wrong | "Prices unavailable" |
| 426 (schema too old) | The mirror keeps working; no new data | Update card: "Update to keep receiving game data" |
| 401 or revoked token | Re-registers once, then shows an error | Admin card error with the reason |
| ITAD revokes the hub's key | The kill switch tombstones the ITAD group; instances drop to "no prices" and lose ITAD boxart | "Deals unavailable from the relay": the Prices stat and source badge read "Unavailable", covers fall back to placeholders, and a hint points to an own ITAD key under Advanced, which restores them (relay card sheet, `pricesRevoked`) |
| Hub database rebuilt | New `catalogEpoch`: instances refetch the snapshot and re-match adopted rows by external ID | The admin card notes a re-sync |

**Relay off.** Switching the relay off entirely restores today's behaviour exactly.

### 17.10 How onboarding changes

- **Claim screen (C4, still one screen).** Add one line under the form: "Game data comes from the Raid Ledger relay. What's shared →". A successful claim triggers enrollment (R-4).
- **Wizard step 6, "Game data"** (replaces "Optional integrations"):
  - **Header card:** "Game data: served by the Raid Ledger relay ✓", with live status (games mirrored, last sync, and prices on or off (after R17)) turning amber or red per §17.9, and the "What's shared" link.
  - **Per-provider rows, each with a badge** (`Relay` / `Your key` / `Needs your key` / `Off`):
    - **Catalogue, titles, dates, genres (Wikidata) and prices (ITAD):** Relay ✓. Advanced ▸ "Use my own ITAD key". Source lines read "Through the Raid Ledger relay · data from Wikidata / IsThereAnyDeal", the IsThereAnyDeal credit is a link, and price claims carry an "after R17" tag until R17 ships.
    - **IGDB, a recommended upgrade shown up front:** "Add your own IGDB key for covers, descriptions and ratings. Stays on this server."
    - **Steam / Battle.net, one info row up front:** "Players link Steam from their own profile, and Steam sign-in works without a key. WoW characters are imported one at a time with this server's Battle.net client." Both keys sit under Advanced.
    - **Advanced: your own keys ▸** the Steam Web API key (library import, wishlists, playtime), this server's Battle.net client (`client_credentials`; WoW character import, one character at a time, not per player) and your own ITAD key (instead of the relay's prices, after R17). Twitch stream counts come with the IGDB key.
    - **Contribute game IDs to the relay:** on by default (R-15), with the "What's shared" link.
    - **Co-Optimus:** absent in the cloud flavour.
  - The step can be skipped, and C7's "finish later" applies.
- **Admin → Integrations.** The same card comes first. A `relay` block on `/system/status` replaces `relayHubEnabled` on `/system/version` (`version.controller.ts:28-39`, which the web app never reads).
- **Design.** Only the Keys / KeysLight sheets need revising before R14 and R15; they and the relay card now carry the licensing fixes (linked ITAD credit, `pricesRevoked` state, "after R17" tags, strict R-13/R-14). The claim, Discord and update sheets stand as approved.

### 17.11 Relay stories and the merged order (dependency-ordered)

Sizes follow §14. "Needs" lists what the operator must provide first.

| # | Title | Scope | Depends on | Size | Needs |
|---|---|---|---|---|---|
| R1 | `chore(relay): pin the hub URL to a confirmed domain; read the baked APP_VERSION` | `DEFAULT_RELAY_URL` (`relay.service.ts:18`) and the canary default (`relay.canary.ts:4`) point at the confirmed host; `APP_VERSION` (`:19`) reads the baked env. Trivial tier | R-1 | S | Domain |
| R2 | `feat(contract): relay wire shapes v2` | §17.12's deviations: crosswalk identity (QID, multiple IDs per kind with primary and confidence), licence-split field groups (meta vs ITAD), RL vocabulary with the legacy IGDB-number map, contribution, search/resolve, price and price-interest DTOs, `catalogEpoch`; `normalizeGameName` moves into contract. `--full` gate | R-18 | S–M | none |
| R3 | `feat(relay): hub service skeleton` | New `relay/` workspace, image and CI job; health; register/heartbeat/rotate/disconnect; token hashing; limits; revoke and rollback CLI; hub DB; minimal heartbeat (R-5); the no-IGDB source guard | R2, R-11 | **L** | none |
| R4 | `feat(relay): hub crosswalk store, changes feed and public snapshot` | The §17.1 schema (per-ID provenance included), matching order and conflict rules; the D15 serving filter; cursor deltas; weekly snapshot file; `catalogEpoch`; merges, tombstones, kill switch; import of the rebuilt seed as `rl_seed`, plus R6's hub-only legacy matching-keys file into `rl_game_names` as never-served, match-only keys (never in the snapshot, deltas, search or resolve) | R3, R6 | M | none |
| R5 | `feat(relay): Wikidata ingest` | Paged SPARQL load with P9043 qualifiers and `en`→`mul` titles; resumable with backoff; compliant User-Agent; EventStreams + EntityData updates; weekly sweep; redirect-to-merge; the 7-day hold queue; sitelink count | R4 | M–L | none |
| R6 | `chore(seed): rebuild games-seed.json from Wikidata + RL fields; retire the IGDB seed scripts` | §17.8's finding. Unconditional, and it blocks the public launch (R-9). Keeps the MMORPG slot layout through the legacy map. Also produces a hub-only legacy matching-keys file (today's IGDB names and slugs, each marked match-only) alongside the Wikidata/RL image seed; the file never ships in the image, and R4 imports it | R2 | S–M | none |
| R7 | `feat(relay): hub ITAD identity` | Steam app ID → ITAD UUID via the lookup endpoints; the ITAD field group (the UUID confirmed by the hub's own lookup, D15, with Steam IDs following D15's Steam rule, and, only if R-12 is approved, the boxart URL string as ITAD's own `cdn.itad.com` URL, never proxied, mirrored or cached by the hub or Cloudflare; no tags or early-access flag, so the hub caches prices, IDs and, if R-12 is approved, ITAD's boxart URL string (a reference only, no image bytes); nothing else); token-only; byte-for-byte URL test | R4 | M | ITAD app registration (before launch) |
| R8 | `ops(relay): deploy the hub` | Hosting per R-2; Cloudflare with only the snapshot cached; uptime monitor; daily off-site dump; runbook | R3, R-1, R-2 | S–M | Hosting account, domain |
| R9 | `feat(relay-client): catalogue mirror + adoption` | `relay_catalog` table; snapshot + deltas + epoch; `games.relay_game_id`, `game_field_overrides`, `relay_sync_conflicts`; adoption inside `withGameNameLock` with the §4.3 rule (append to `reference_games_insert_paths`) | R2 (against a fixture hub); R4 to go live | **L** | none |
| R10 | `feat(relay-client): default-on enrollment` | Enroll after the claim or first admin login; new installs on, a migration writes an explicit off for existing installs, plus an admin prompt (R-3); opt-out env and toggle; claim-screen disclosure line | R9, #8, R-3, R-4 | M | Domain (R1) |
| R11 | `feat(relay-client): relay tier in search and resolve` | Pipeline: local games → local mirror → hub read-through → own IGDB → own ITAD. Steam discovery resolves against the mirror (§17.7) | R9, R4 | M | none |
| R12 | `feat(relay): identity contributions` | Instance outbox and batching, with per-ID provenance (D15); hub endpoint; Wikidata and ITAD validation; verdicts; trust tiers and quorum; quarantine; conflict queue, including `steam`-provenance IDs that disagree with P1733 or another contributor; rollback. Instance side: `games.steam_app_id_source`, its trigger and the SQL backfill (§17.3; one migration, `--full` gate, about 2 lanes, can split out). Absorbs ROK-1485 slice 2, reduced to IDs and names | R9, R5, R7 | **L** | R-15 |
| R13 | `feat(relay-client): source precedence + own-key enrichment on shared IDs` | Per column: admin override > own key > relay > seed (R-6); own IGDB cron keyed by the crosswalk's ID while keeping a local `igdb_id`; blank on tombstones | R9 | M | none |
| R14 | `feat(ui): relay status card + degraded states` | Admin card, `relay` status block, search hint, one shared cover-fallback helper, hidden summary and rating blocks, stale-price rule, the ITAD-revoked (`pricesRevoked`) state, 426 copy | R9, Keys sheet | M | Design |
| R15 | `feat(onboarding): "Game data" step` (**replaces §14 #11**) | The §17.10 screen | R14, #10 | S–M | Design |
| R16 | `feat(ui): attribution on every instance` | "Data from Wikidata" on game pages, and ITAD attribution, as a link, wherever prices, deals or ITAD boxart render; a fail-loudly guard test like ROK-1398's | R7 | S | none |
| R17 | `feat(relay): hub ITAD prices per country` | The priced set per R-17; refresh every 6 h per active country; `GET /prices`; instances hide prices older than 24 h; token-only | R7, R-17 | M | none |
| R18 | `docs: relay privacy note + Host-your-own update` | §17.7 in plain words; the per-provider own-key table; attribution; opt-outs. Folded into §14 #16 | R10 | S | none |
| later | ROK-1485 slices 3–6 | Hub dashboard (ROK-304), Co-Optimus through the relay (ROK-1420, not planned), ROK-274, cross-instance LFG. Unchanged | R9 | as in ROK-1485 §10 | — |

**Merged order (supersedes §14's "Suggested order"):**
0. **The operator, now:** confirm the domain (R-1), choose hosting (R-2), register the ITAD app, and rule on the open R-decisions (§12).
1. **No dependencies:** #1, #2, #3, #9, R2.
2. #4, #5, #6, #7, R1, R3, R6.
3. R4 and R9 in parallel (R9 against a fixture hub), then R5 and R8.
4. R7 and R16, then R11 and R13, then R12.
5. **After the claim and wizard sheets plus the revised Keys sheet:** #8, R10, #10, R14, R15.
6. **After §13's proof deploys:** #12, #13, #14. They can merge as a beta. The public announcement waits for R5 + R6 + R9 + R10 (R-9).
7. R17, #15, then #16 with R18.

**Totals:** 18 relay stories: 3 L (R3, R9, R12); 8 M or M–L (R4, R5, R7, R10, R11, R13, R14, R17); 7 S or S–M (R1, R2, R6, R8, R15, R16, R18). Dropped from the earlier draft: IGDB enrichment on the hub (ruled out), and the conditional seed strip, which is now the unconditional R6.

**Gated on the operator:** the domain and hosting (R1, R8, R10), the contribution defaults (R12: R-15), the priced set (R17: R-17), the vocabulary (R2: R-18) and the design (R14, R15).

### 17.12 Deviations from the ROK-1485 contract

| ROK-1485 | This design | Why |
|---|---|---|
| §3.2 identity: one nullable ID per provider | Adds `wikidataQid`; several IDs per kind, one primary, each with `source` and `confidence`; a contributed ID also carries its `provenance` (D15) | The FFXIV case; Wikidata as the source of cross-references |
| §3.2 enrichment: IGDB cover, summary, ratings, screenshots, videos, themes and IGDB genre numbers | Removed from the wire. Split into a CC0/RL `meta` group and a token-only `itad` group; RL vocabulary codes | IGDB content never crosses the hub; field groups follow licences |
| §4.1 snapshot = changes feed from `''` | A static public snapshot file per epoch; deltas unchanged | 178k items; nothing in it is licence-gated, so it can be edge-cached |
| §4.2–4.3 sync inserts into `games` | Mirror into `relay_catalog`; the §4.3 rule runs on adoption | Keeps 178k rows out of `games` and keeps libraries off the hub |
| §4.4 contributions (slice 2) send identity **plus enrichment** | Slice 1 scope, **IDs and name only**, with validation and trust tiers | Operator model, item 2 |
| §4.6 "relay wins on canonical" | Admin override > own key > relay > seed | R-6 |
| §3.6 register/heartbeat carries `communityName` and stats | Behind a stats opt-in | R-5 |
| No price shape | Price and price-interest DTOs | R17 |
| §3.3 co-op facts | Unchanged, left unpopulated | Co-Optimus stays local |
| §5 and §6: contributions need `catalogSync` (off means no pulls and no contributions), and connecting is opt-in | The relay is on by default for new installs (R-3), with a separate contribute toggle that is on by default (R-15) | The operator's zero-config direction (§17 quote); pulling and contributing are separate consents, so an admin can take the catalogue without sending anything |
| §3.4 alias `kind` enum: `igdb_id\|steam_app_id\|itad_game_id\|slug\|normalized_name` | Adds `wikidata_qid`, `itad_slug`, `itad_uuid`, `twitch`, `battlenet` and `gog` | The crosswalk carries every Wikidata cross-reference (§17.1), and ITAD's slug (P12570) is not the UUID its API uses (§17.2) |
| §4.5 size model: 2–10k games, about 8 MB gzipped | About 178k games, 10–20 MB gzipped (est.), mirrored into `relay_catalog` | Wikidata's full video-game set (§17.4); R-7 keeps the smaller top-20k alternative |

### 17.13 Emails and operator actions

1. **IGDB: no email.** Ruled out 2026-09-23. Nothing IGDB-sourced passes through the hub, and R6 removes the IGDB content from the image.
2. **ITAD (non-blocking, before launch).** Register the hub as its own app at `https://isthereanydeal.com/apps/`. Describe the model: the hub caches prices, IDs and, if R-12 is approved, ITAD's boxart URL string (a reference only, no image bytes); nothing else: no tags, early-access flags or other ITAD metadata (boxart stays ITAD's own URL, hotlinked, never proxied, mirrored or cached), instances display with a linked attribution, and shop URLs pass through byte-for-byte.
3. **Wikidata.** No permission is needed. Comply with the User-Agent policy and show the attribution.
4. **Co-Optimus.** Not needed; renegotiation stays optional and not planned.
5. **Not recommended:** Twitch, Valve or Blizzard. Their terms are explicit, and each instance uses its own credentials: its own Steam Web API key (players link their own accounts), this server's Battle.net client (`client_credentials`, characters imported one at a time) and the instance's own IGDB/Twitch client.

**Operator actions that aren't emails:** confirm ownership of `raid-ledger.com` or pick a hub domain the operator owns (R-1), and open the hub's hosting account (R-2).
