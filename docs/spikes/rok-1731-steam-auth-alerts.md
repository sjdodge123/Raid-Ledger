> **Source:** `planning-artifacts/INV-steam-auth-alerts-2026-10-04.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-04
> **Linear:** ROK-1731

# INV — Delayed Steam sign-in alerts after linking Steam (2026-10-04)

Read-only investigation. Sources: `origin/main` code, prod log export (local log archive, path withheld) (newest; covers ~2026-09-28 → 2026-10-04 23:45Z), web research. Fleet slot-4 (`rok-1366-nonce`) logs were NOT read (no agent path to env access logs without SSH); fleet conclusions come from code.

## 1. Every outbound call to Steam (origin/main)

| Call | Where | When | Auth |
|---|---|---|---|
| Browser 302 to `steamcommunity.com/openid/login` (`checkid_setup`) | `steam-http.util.ts::buildSteamOpenIdUrl`, from `SteamAuthController.redirectToSteamOpenId` | user clicks Link | The **user's browser** signs in to Steam here. This is the only real Steam sign-in in the flow. |
| `POST steamcommunity.com/openid/login` `openid.mode=check_authentication` | `steam-http.util.ts::verifySteamOpenId` | once per `/auth/steam/link/callback` | Server-to-server from prod NAS / fleet VM IP. No user cookies or credentials; it only asks Steam to confirm the signature. |
| `ISteamUser/GetPlayerSummaries` | `getPlayerSummary` | on callback (privacy check) and on every `GET /auth/steam/status` | API key only |
| `IPlayerService/GetOwnedGames`, `IWishlistService/GetWishlist` | `steam.service` / `steam-wishlist.service` | fire-and-forget right after link (`startSteamPostLinkSync`), manual `/sync`, and the daily cron `SteamSyncProcessor.scheduledSync` (`EVERY_DAY_AT_4AM`; container TZ is UTC) | API key only |
| `ISteamWebAPIUtil/GetSupportedAPIList` | `admin/settings-api-test.helpers.ts` | admin "test key" button | API key only |

None of the API-key calls act as the user, and none can produce a user-facing Steam login notification. **Only the browser's own sign-in on steamcommunity.com does that.**

Replay guards on main:
- `GET /auth/steam/link?nonce=` uses a single-use 120s nonce that only works from the browser holding its cookie (ROK-1630). Replaying it from history sends a 302 to the "Link request expired" page **without ever contacting Steam**. This means the operator's 18:48Z fleet replay step could not cause a Steam call.
- `/link/callback` checks an HMAC state (10-minute expiry) and `assertLinkStateBoundToBrowser` (ROK-1366). That check runs **before** `verifySteamOpenId` and clears the state cookie, so a replayed callback is rejected before any `check_authentication` call is made.
- Gaps: `verifySteamOpenId` does NOT check that `openid.return_to` equals our callback URL, does not check `openid.op_endpoint`, does not check that `claimed_id == identity` or that both are in `openid.signed`, and keeps no local `response_nonce` store. It relies entirely on Steam's `is_valid:true`.

## 2. Prod logs

Only **one** Steam link event in the whole export:

| Time (UTC) | Request | Status | Notes |
|---|---|---|---|
| 19:46:25–19:46:38 | Discord OAuth → `exchange-code` | 302/201 | new user (onboarding) |
| 19:46:40 | `GET /api/auth/steam/link?token=…` | 302 | Referer `/onboarding` |
| 19:47:15 | API: `Steam account …[redacted] linked to user [redacted]` | — | `check_authentication` succeeded |
| 19:47:16 | `GET /api/auth/steam/link/callback?state=…&openid.*` | 302 (81 B) | Referer `steamcommunity.com`; success redirect |
| 19:47:17 | `GET /api/auth/steam/status` | 200 | linked |
| 19:47:44 | `POST /api/users/me/complete-onboarding` | 201 | |

- Every Steam hit is a single mobile-browser session. Client IPs are logged only as the Docker gateway address, so the real source IP cannot be determined.
- **No second hit** on `/link` or `/link/callback` between 19:47:16Z and the end of the export at 23:45Z. No other user agent (scanner, unfurl bot, prefetch) ever fetched a Steam URL, and our server made no later `check_authentication`.
- No `Steam link error`, no `Auto-sync … failed`. The only other Steam activity is the daily 04:00Z API-key sync, which was routine on every day (6 users).
- **Prod is behind main.** Prod still uses the pre-ROK-1630 `GET /api/auth/steam/link?token=<JWT>` flow, so a bearer token travels in the URL and lands in the nginx access log and browser history. ROK-1366 browser binding probably isn't on prod either. Main has both fixes.

## 3. Steam side (web)

- Steam is an OpenID provider. The site sends the user to steamcommunity.com, the user **signs in on Steam's own page**, and the browser is redirected back with OpenID data. Source: https://partner.steamgames.com/doc/features/auth (accessed 2026-10-04).
- Since the Steam Mobile App update, regular Steam sign-ins are confirmed with approve/deny prompts, which show the approximate location of the signing-in device. Source: "The updated Steam Mobile App is now available", 2022-10-12, https://store.steampowered.com/news/posts/?enddate=1665616679.
- Users report "new sign in request" notifications that show up oddly, out of step with the actual sign-in attempt. Source: Steam forum thread "New sign in request", 2024-05-28, https://steamcommunity.com/discussions/forum/1/4328601293420726859.
- Steam support says Steam Guard emails can arrive late. Steam advises waiting up to 3 hours before contacting support. Source: https://help.steampowered.com/faqs/view/06B0-26E6-2CF8-254C.
- I found no source saying that a server-side `check_authentication` call (or a re-check from another IP) triggers any user notification. It carries no session or credentials, so on the protocol it is only a signature check. **This is inference, not something Valve documents.**

## 4. Ranked hypotheses

1. **(Most likely) The alert is for the user's own sign-in on steamcommunity.com during linking, delivered late or as a follow-up "new device / new sign-in" notice.** The prod user linked from a mobile browser during first-time onboarding. That was most likely a fresh Steam web sign-in on a browser Steam hadn't seen before. Steam's sign-in and new-device notices arrive by email and the mobile app, and both can lag. The operator's fleet link (~18:10Z) follows the same pattern. Our logs show nothing that could have caused a *second* sign-in.
2. **The daily sync cron or a profile call being taken for a sign-in.** Ruled out. These calls are API-key only, and the next cron after the prod link ran 04:00Z Oct 5, not "a few hours" after.
3. **A replayed OpenID return URL re-checked later.** Ruled out on prod: only one callback hit. Ruled out on main: the browser-bound state check runs before `check_authentication`.
4. **The operator's 18:48Z replay test.** It cannot reach Steam: the nonce is spent, so the request ends in our own 302 error before any Steam call.
5. **(Low, but don't dismiss) A real third-party sign-in attempt on the user's Steam account at about the same time.** The user should check the alert's details (location and device). If it is not his, he should deauthorize other devices and change his password.

## 5. Security concerns vs expected

- **Expected:** a Steam sign-in or new-device notification caused by the user's own OpenID sign-in. Our backend never signs in to Steam as the user.
- **Real issue (prod only, fixed on main):** the `?token=<JWT>` link URL puts a bearer token in nginx logs, browser history and the Referer header. Ship ROK-1630 / ROK-1366 to prod. Also check that log exports keep scrubbing `token=` (this export showed the parameter but I didn't print it).
- **Hardening (low/med):** in `verifySteamOpenId`:
  - require `openid.op_endpoint === STEAM_OPENID_URL`;
  - require `openid.return_to` to start with our exact callback URL;
  - require `claimed_id === identity`, and both of those plus `return_to` and `response_nonce` in `openid.signed`;
  - keep a short-lived Redis `SETNX` store of seen `response_nonce` values (rejecting nonces with a timestamp more than about 5 minutes old) instead of relying only on Steam.
  Add `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on `/auth/steam/link*` responses.
- **Logging gap:** nginx logs the Docker gateway address rather than the client IP. Log `$http_x_forwarded_for` or use the real-ip module so incidents like this can be traced.
- **User docs:** add a one-liner to the Steam link UI or FAQ: "Steam may email or notify you about this sign-in, sometimes hours later. That's expected; Raid Ledger never sees your password."
