# ROK-973 spike: `CORS_ORIGIN=auto` threat model and a safe migration path

Status: spike output, no code. Author: spike lane, 2026-10-01. Base: `origin/main` @ `45b3c55e7`.
Scope: the story's Q1, Q2, Q4 and Q5. **Q3 (the full list of valid origins) is left to the operator** (§5).
Nothing on this branch changes the API, nginx or either Dockerfile. Every recommended change in §7 is a
follow-up. An entrypoint or nginx change would go in its own infra PR (CLAUDE.md "Infrastructure Changes").

## Provenance

| Input | Source |
|---|---|
| Story body and ACs | Linear ROK-973 (Backlog, labels Spike + Infrastructure; related ROK-1366, ROK-1590). No comments on the issue. |
| Current behaviour | `api/src/main.helpers.ts`, `api/src/main.ts`, `nginx/monolith.conf.template`, `Dockerfile.allinone`, `api/src/auth/refresh/*` at the base commit |
| History | `git log -S CORS_ORIGIN` plus commits `2185e974a` (#94), `f71d7b709`, `1c218515c` (#104), `475adfe90` (#329), `58b2fd87d` (#885, ROK-1353) |
| Fleet hostnames | `rl-infra/README.md:846` (slot-N and per-slug hosts), `rl-infra/README.md:1110` (dashboard) |

`UNKNOWN — operator` marks anything that code, git and the issue cannot settle. `UNVERIFIED` marks a
claim this lane reasoned to but did not execute (no tests or requests were run).

## TL;DR

- **Q1. Nginx does not make CORS moot.** The monolith nginx has one catch-all server block with no Origin
  or Host filtering. CORS is enforced by the browser on behalf of a signed-in user, and that user's
  traffic goes through nginx too. "Nginx is the only path to the API" says nothing about which pages
  can make that browser send requests.
- **Q2. The earlier break was a value mismatch, made worse by how errors are handled.** On 2026-02-19 the
  entrypoint derived `CORS_ORIGIN=http://localhost:80`. Browsers send `Origin` on same-origin POSTs, so
  every POST from the real hostname was rejected. The rejection is thrown as an `Error`, and #104 records
  it surfacing as a 500. `auto` was added the same day as the fix. Git has no later CORS outage.
- **Q5. `auto` was nearly harmless when the story was written. It no longer is.** In 2026-03 the API had
  no ambient credential. ROK-1353 (2026-06-07, #885) added the httpOnly `rl_rt` refresh cookie. `auto`
  reflects any origin with `credentials: true`, so any **same-site** page (any `*.gamernight.net`
  sibling, including the fleet's slot envs and dashboard) can call `POST /api/auth/refresh` with the
  victim's cookie and read back a fresh access JWT. `SameSite=Strict` blocks cross-site pages, not
  same-site ones.
- **Q4. An explicit list or a regex is feasible but has the wrong trade-off.** Today's code accepts
  exactly one string, so either option needs code. Both bring back the #104 failure mode for every
  self-hoster whose access path changes.
- **Verdict:** this is a real but conditional vulnerability (my rating: **med**), so it is not a
  "won't fix". **Recommendation:** keep `auto` as the zero-config default but redefine it as
  *same-origin only*: allow an `Origin` only when it matches the request's own host. Roll it out
  report-only first, with an env rollback. Optionally add a `Sec-Fetch-Site` guard on
  `/auth/refresh` and `/auth/logout`. Details in §6 and §7.

## 1. What `auto` does today

| Anchor | Behaviour |
|---|---|
| `Dockerfile.allinone:398-399` | The entrypoint sets `CORS_ORIGIN=auto` when it is unset. |
| `Dockerfile.allinone:401-403` | On Render, `auto` is replaced with `RENDER_EXTERNAL_URL`, an explicit origin. |
| `Dockerfile.allinone:632` | Image default `ENV CORS_ORIGIN=auto`. `:628` sets `NODE_ENV=production`. |
| `Dockerfile.allinone:410` | `CLIENT_URL` is derived from `CORS_ORIGIN` only when it is not `auto`. |
| `api/src/main.helpers.ts:139-160` | `validateCorsConfig`: production throws on unset or `*` and **only warns** on `auto` (`:154`). |
| `api/src/main.helpers.ts:170-192` | `buildCorsOriginFn`: no `Origin` → allow. **`isAutoOrigin` → allow any origin (`:177`).** Otherwise it matches **one** string; dev adds localhost variants; a mismatch calls back with `new Error('Not allowed by CORS')` (`:189`). |
| `api/src/main.ts:64-73` | `enableCors({ origin: buildCorsOriginFn(...), credentials: true, exposedHeaders: [...] })`. |
| `Dockerfile.allinone:63` + `web/src/constants/api.ts:4` | The allinone web build uses `VITE_API_URL=/api`, so **the real frontend only ever calls the API same-origin.** |

**The code never did what the commit said.** The #104 message says auto mode "dynamically allows the
request's own origin". The code at `main.helpers.ts:177` never compares the `Origin` with the request's
host. It allows every origin. The startup warning's line "intended for single-origin reverse-proxy
deployments only" carries the same assumption.

**`auto` also drops a server-side check.** With an explicit origin, a mismatched `Origin` ends in an
`Error` and the handler never runs. That blocks simple cross-origin POSTs, which need no preflight. In
`auto` mode those POSTs reach the handler.

## 2. Q2: what broke last time (2026-02-19, from git)

All on one day:

1. **#94 (`2185e974a`)** made production reject `CORS_ORIGIN=*`. The allinone Dockerfile still defaulted
   to `*`, so the container crashed at startup (see the `f71d7b709` message: "preventing the startup crash").
2. **`f71d7b709`** derived `CORS_ORIGIN=http://localhost:${NGINX_PORT:-80}` when Render's URL was absent.
3. **#104 (`1c218515c`)** records the result: "With CORS_ORIGIN=http://localhost:80, the CORS middleware
   rejects requests from the actual hostname (e.g. https://raid.example.com), causing all POST endpoints
   to return 500." The same commit added `auto`.

Root cause:

- **A wrong value.** The derived origin was not the origin browsers actually use.
- **Two things made it worse:**
  - Browsers send `Origin` on same-origin non-GET requests. So GETs kept working and every POST,
    including login, failed.
  - The rejection is an `Error`, so it surfaced as a server error rather than a clear CORS denial.

It was not an nginx/API disagreement. Nginx passes `Origin` through untouched.

Not in git:

- **The "later production outage from setting an explicit value"** in the story. The only CORS commits
  between 2026-02-19 and the story's creation (2026-03-26) are #329 (`475adfe90`, CLIENT_URL
  auto-detection, later replaced by ROK-1627) and batch #480. **UNKNOWN — operator:** was there a
  separate incident, for example a hand-set `CORS_ORIGIN` in the NAS compose file, which git would not
  record? If not, the story's "previous attempt" is the event above.
- **Which deployment the 2026-02-19 break hit (NAS or Render).** UNKNOWN — operator.
- **The status code today.** #104 recorded a 500. This lane did not check what a rejected origin returns
  now, through `SentryExceptionFilter` at `main.ts:80`. UNVERIFIED.

## 3. Q1 + Q5: threat model

### 3.1 Nginx enforces nothing about origin

`nginx/monolith.conf.template:32-33`:

- There is one server block, `listen ${NGINX_PORT}; server_name localhost;`. As the only block it is
  the default server and answers **any** `Host`.
- `location /api/` (`:69-77`) proxies to `127.0.0.1:3000`. It forwards `Host $host` (port stripped),
  `X-Forwarded-For` and `X-Forwarded-Proto`.
- There are no `Origin`, `Referer` or `Host` checks.

So the story's premise, that "Nginx already enforces origin/host restrictions", does not hold.

**Port exposure is a different question.** Whether port 3000 is published by the NAS compose file
(**UNKNOWN — operator**; the image only `EXPOSE`s 80, `Dockerfile.allinone:639`) only matters for
bypassing nginx. It does not affect the browser-driven attack below, which goes through nginx like
legitimate traffic.

### 3.2 What a permissive CORS policy can actually leak

There is only one ambient credential:

- Normal API calls authenticate with a Bearer access token that the web app keeps in its own storage
  (`web/src/lib/api/auth-storage-keys.ts`). A foreign page cannot attach it.
- So for almost every endpoint, `auto` gives a foreign page what `curl` already gets: public data.
- The ambient credential is the **`rl_rt` refresh cookie** (ROK-1353, #885, 2026-06-07):
  - set at `api/src/auth/refresh/refresh-cookie.helpers.ts:29-35` as `httpOnly`, `secure` and
    `sameSite: 'strict'` in production, with `path: '/'`, host-only (no `Domain`);
  - issued on local login (`api/src/auth/local-auth.controller.ts:88`) and Discord login
    (`api/src/plugins/discord/discord-auth.helpers.ts:28`), so every signed-in production user has one.

`POST /auth/refresh` (`api/src/auth/refresh/refresh-token.controller.ts:41-53`):

- It is not JWT-guarded. It reads `rl_rt`, rotates it, sets the new cookie, and **returns
  `{ access_token }` in the JSON body.**
- Under `auto`, a `fetch(url, { method: 'POST', credentials: 'include' })` from a foreign page:
  - is a simple request, so there is no preflight;
  - gets `Access-Control-Allow-Origin: <that page>` plus `Allow-Credentials: true`;
  - so its response body can be read.

What decides whether the cookie is sent is `SameSite`, not CORS:

| Attacker page | `rl_rt` sent? | Outcome under `auto` today |
|---|---|---|
| Cross-site, e.g. `https://evil.example` | No (`SameSite=Strict`) | 401, nothing leaks. **Blocked by the cookie, not by CORS.** |
| Same-site, any `https://*.gamernight.net` sibling | **Yes.** Same registrable domain, assuming `gamernight.net` is not on the Public Suffix List (UNVERIFIED, but it is a private domain). | **The victim's fresh access JWT is readable by the page.** |
| Same origin, `https://raid.gamernight.net` | Yes | Legitimate use. |

What the attacker gets:

- A valid access token, ~1h by the `signAccessToken` comment (`refresh-token.controller.ts:39`), carrying
  the victim's role. The operator is an admin.
- It can be repeated on every visit to the attacking page.
- **Reuse detection does not fire.** The rotation is legitimate: the victim's own browser presents the
  current cookie and stores the rotated one. The `refresh` rate limit (60/min,
  `api/src/throttler/rate-limit.decorator.ts:35`) is no barrier at that volume.

### 3.3 The same-site siblings that exist

These come from the repo. The full DNS inventory is the operator's.

- **`https://slot-N.gamernight.net`**, the fleet envs (`rl-infra/README.md:846`). They are allinone
  images (so `NODE_ENV=production` and `CORS_ORIGIN=auto`) running **unreviewed branch builds** with
  DEMO_MODE affordances. An XSS bug in any branch the operator opens in a test plan executes same-site
  with prod.
- **`https://{slug}test.gamernight.net`**, the per-slug env URLs (same README line).
- **`fleet.gamernight.net`**, the fleet dashboard: "no auth" per `rl-infra/README.md:1110`. It renders
  tester comments and serves screenshot attachments (`/api/test-plans/<slug>/attachment/<file>`).
  **UNKNOWN — operator/rl-infra:** does the dashboard sanitize comment HTML, and does it serve
  attachments with a non-HTML `Content-Type`? A stored XSS there would be a same-site foothold.
- **Any other homelab `*.gamernight.net` host.** UNKNOWN — operator.

The fleet envs are also same-site with each other, so a slot-1 page can read a slot-2 session. That only
exposes test data and is low value.

### 3.4 Q5 answer

`auto` was an acceptable trade-off **under the 2026-03 premise**: no ambient credential, so permissive
CORS leaked only what was already public.

Since ROK-1353 it is **not** acceptable as it stands. The exposure is narrow but real: any script
running on a `gamernight.net` sibling can take the operator's session.

The risk depends on two things together:

1. a script foothold on a sibling origin, which is plausible because the fleet runs unreviewed code on
   those siblings by design;
2. the victim's browser being signed into prod at the time. That is likely for the operator, who tests
   slot envs in the same browser (UNKNOWN — operator).

**Severity (my judgement): med.** It is not exploitable from the open internet without a sibling
foothold.

## 4. Q4: an explicit list or a regex?

The code today accepts **one** string (`main.helpers.ts:179-190`; the `allowed` array starts as
`[corsOrigin]`):

- A comma-separated value such as `https://nas.local,http://192.168.*` is compared as one literal
  string, so it rejects every origin. That is the #104 outage again.
- The `cors` package supports arrays and `RegExp`, but our callback wraps it, so **any list or regex
  support is a code change**.

| Option | Security | Operational cost | Failure mode |
|---|---|---|---|
| **A. Explicit list** (`CORS_ORIGIN=https://raid.gamernight.net,http://nas:8080,...`) | Exact | Every new access path (DHCP IP change, port remap, new Tailscale name, new reverse-proxy hostname) needs an env edit and a container restart. It is unusable for the ROK-1590 one-click-deploy audience, who will not know their origin up front. | Every POST rejected, **login included**. A self-hoster is locked out until they find the env var. |
| **B. Regex/glob** (the story's `http://192.168.*`) | Error-prone. Unanchored `192.168.*` also matches `https://192.168.evil.example`; `.` must be escaped. A LAN wildcard admits every LAN device and every other service on the NAS's IP. | As A, plus regex review. | As A. |
| **C. Same-origin `auto`**: allow iff `Origin`'s host equals the host the request was addressed to | Blocks every sibling and cross-site origin. Allows exactly what the real frontend uses, since it is same-origin (§1). | **Zero config.** Works on any hostname, IP or Tailscale name without listing them, so Q3 stops being a prerequisite. | If an outer proxy rewrites `Host`, the comparison fails and POSTs are rejected. That is the #104 class again, so it needs report-only rollout (§6). |
| **D. C plus an optional explicit-extras list** | As C | Only for genuine cross-origin consumers. Dev localhost is already handled for non-production. | As C. |

How C would be implemented:

- NestJS `enableCors` accepts the `CorsOptionsDelegate` form `(req, cb)`
  (`node_modules/@nestjs/common/interfaces/external/cors-options.interface.d.ts:55`), so the origin
  decision can see the request's `Host` header. The current `CorsOriginFn` only receives the origin.
- Two details to settle in the follow-up:
  1. **Nginx forwards `Host $host`, which drops the port** (`monolith.conf.template:74`). The API can
     only compare hostnames, so a different service on the same hostname with a different port would
     pass. Closing that needs nginx to send `X-Forwarded-Host $http_host`, an **infra PR** of its own.
     It is optional, since same-host-other-port is a much smaller set than every `*.gamernight.net`.
  2. **Any outer proxy must preserve `Host`.** That is the Synology DSM reverse proxy, a Cloudflare
     tunnel, or whatever fronts `raid.gamernight.net` (**UNKNOWN — operator**). If it rewrites `Host`
     (for example to `localhost:8080`), C rejects legitimate POSTs. Report-only mode measures this
     before anything is enforced.
- **Why this does not reopen ROK-1627.** ROK-1627 (`main.ts:76-77`, `ClientUrlSeederService`) stopped
  deriving `CLIENT_URL` from request headers because a `curl` attacker controls `Host`, and the derived
  value was **persisted**. A CORS check is per-request, and the threat is a *victim's browser*:
  - page script cannot set `Host` or `Origin`, which are forbidden headers;
  - a `curl` attacker who forges both has no `rl_rt` cookie to abuse.

  So `Origin` agreeing with `Host` is a sound browser-side signal, and nothing is stored.

## 5. Q3: which origins are valid? OPERATOR

Left to the operator by brief. This lane does not enumerate NAS IPs, hostnames or Tailscale names.
Known from the repo/memory only: production is `https://raid.gamernight.net`.

**If option C is chosen, Q3 no longer blocks the fix.** It only matters for any extras in option D.

One observation for the operator while answering Q3:

- In production the refresh cookie is `secure` (`refresh-cookie.helpers.ts:31`).
- Browsers refuse to set a `Secure` cookie from a plain-`http://` origin.
- So sessions opened over `http://<LAN-IP>` get no `rl_rt` at all.

UNKNOWN — operator: is plain-HTTP LAN access still used? It is unrelated to CORS, but it bears on which
origins are actually "valid".

## 6. Verdict and recommendation

**Verdict:** `CORS_ORIGIN=auto` as implemented is a **real, conditional vulnerability** (med). It is not
mitigated by nginx, and the original "single-origin behind nginx" reasoning no longer holds since
ROK-1353. The story's "won't fix" branch does not apply.

**Recommendation:** a follow-up story. It is `standard` tier: security-relevant CORS behaviour in
`api/src/main.helpers.ts`. It is not under `api/src/auth/**` unless the optional guard is included.

1. **Redefine `auto` as same-origin only (option C).** Allow when `Origin` is absent, or when its
   hostname equals the request's `Host` hostname. Keep the non-production localhost allowances and the
   Render explicit-origin path unchanged.
2. **Roll out report-only first.** For one release, log `{origin, host}` for each would-reject and keep
   allowing. Check the prod logs for false positives (outer-proxy `Host` rewriting), then enforce.
   The mode switch is an env var; the name is the implementer's call.
3. **Rollback plan (story AC 2):** set the mode env back to report/allow-any and restart the
   container. No image rebuild and no Dockerfile change. The old allow-any behaviour stays reachable
   for one release as the escape hatch.
4. **Keep the allinone entrypoint default as `auto`.** Once `auto` means same-origin it is the safe
   default. `Dockerfile.allinone:398-403` needs no change, and Render keeps its explicit origin.
   **Do not** switch the default to an explicit list (option A). That reintroduces #104 for every
   self-hoster and for ROK-1590.
5. **Optional, defense in depth:** reject `Sec-Fetch-Site: same-site|cross-site` on `POST /auth/refresh`
   and `POST /auth/logout`; allow `same-origin` and allow the header being absent (non-browser
   clients). This closes the token-theft path even if CORS is later misconfigured, and stops forced
   logout from siblings, which needs no CORS at all. It touches `api/src/auth/**`, so it stays
   `standard`, and it can be a separate story.
6. **Nits for the same follow-up:**
   - Correct the stale `Dockerfile.allinone:10` comment ("auto-derived from … localhost", which #104
     removed) — this one goes in the infra PR if it is bundled there.
   - Correct the `buildCorsOriginFn` / `validateCorsConfig` doc comments and the warning text.
   - Consider rejecting with `callback(null, false)` plus an explicit 403 rather than a thrown `Error`.

**Not recommended:**

- Moving the fleet off `gamernight.net` to a separate registrable domain. It removes the sibling class
  entirely but costs OAuth redirect and DNS rework. That is an operator call, listed only for
  completeness.
- A regex default (option B).

## 7. Follow-ups (none in this branch)

| Follow-up | Tier / PR shape | Gate |
|---|---|---|
| Same-origin `auto` with report-only mode and an env rollback (§6.1-6.3) | `standard`, API-only PR (`api/src/main.helpers.ts`, `api/src/main.ts`, unit tests for the delegate) | `--static` plus GitHub CI. Unit tests must cover: sibling subdomain rejected; same host allowed; absent `Origin` allowed; port-stripped `Host`; report-only allows but logs. |
| `Sec-Fetch-Site` guard on `/auth/refresh` and `/auth/logout` (§6.5) | `standard` (`api/src/auth/**`) | Integration test on the refresh route |
| nginx `X-Forwarded-Host $http_host` (§4, optional) | **Separate infra PR** | allinone build, start and `/api/health` per CLAUDE.md |
| Fleet dashboard XSS/attachment content-type review (§3.3) | rl-infra; operator triage | n/a |

## 8. Operator questions / open markers

1. **Q3 (OPERATOR):** the valid origins (NAS IP(s), hostnames, Tailscale names). This does not block
   option C.
2. **UNKNOWN — operator:** was there a CORS outage separate from the 2026-02-19 event (§2), for example
   a hand-set compose value? Which deployment did the 2026-02-19 break hit?
3. **UNKNOWN — operator:** what fronts `raid.gamernight.net` (DSM reverse proxy, Cloudflare tunnel,
   other), and does it preserve the `Host` header? This is the risk that decides whether option C
   misfires (§4).
4. **UNKNOWN — operator:** is container port 3000 published in the NAS compose file? It is not relevant
   to the browser threat; it would be a separate nginx-bypass question.
5. **UNKNOWN — operator:** which other `*.gamernight.net` hosts exist beyond the fleet ones in §3.3?
   Do you browse slot envs in the same browser profile that is signed into prod?
6. **UNKNOWN — operator/rl-infra:** does `fleet.gamernight.net` sanitize tester comments, and what
   `Content-Type` does it serve attachments with?
7. **UNKNOWN — operator:** is plain-`http://` LAN access in use? If so, those sessions never get the
   `Secure` refresh cookie (§5).
8. **Decision:** adopt option C (recommended) or A/B? Include the `Sec-Fetch-Site` guard?

## Handover

What this lane did and did not do:

- **Verified at `45b3c55e7`:** every anchor in §1, §3.1, §3.2 and §4 by grep; the commit messages for
  #94, `f71d7b709`, #104, #329 and #885; the NestJS delegate type in the main checkout's
  `node_modules`.
- **Not executed:** no requests and no tests. Two claims are reasoned from code and browser semantics,
  not run:
  - the current status code for a rejected origin (§2);
  - the `fetch` exploit in §3.2.

  A follow-up implementer should prove the §3.2 path with an integration test (a sibling `Origin` plus
  the cookie, expecting a non-readable or rejected response) before and after the fix.
- **Not reached:** the rl-infra dashboard's sanitization (§3.3) and the operator's DNS and proxy
  topology.
