# ROK-2282 — Phone sign-in: hand-off to the Discord app

Status: spike findings, 2026-11-20 — not a build spec

## Summary

- **iPhone/iPad: no.** Discord's own `apple-app-site-association` file tells iOS to open
  `/oauth2/authorize` in the app **only when the URL has no `response_type`**. Every web
  sign-in (ours included) needs `response_type=code`, so iOS keeps it in the browser by design.
- **Android: unknown.** Discord's `assetlinks.json` verifies the app for discord.com, but the paths
  it claims live inside the APK. Chrome also refuses app hand-offs without a recent user tap.
- **Even if the app opened, the way back is risky.** Our callback requires a state cookie set
  in the browser that started sign-in. If Discord opens our callback in a different browser or an
  in-app browser, sign-in fails with `oauth_failed`.
- **Recommendation:** do not build an app hand-off. Fix the "every time" part instead (long-lived
  session, a phone hint, magic link from Discord as the fallback). Run the 5-minute Android test
  below first; it is the only thing that could change this answer.

## How our sign-in works today

**Entry.** Every button goes to `GET /auth/discord` (`web/src/pages/login-page.tsx:123`,
`join-page.tsx:37`, `UserMenu.tsx:259`, `SchedulingSlotRow.tsx:222`). Invites use
`/auth/discord/invite` (`web/src/pages/invite-page.tsx:231`). The navigation is a JS
`window.location.href` change after a tap, then a server 302 to Discord.

**Authorize URL.** `https://discord.com/api/oauth2/authorize?client_id=…&redirect_uri=…&response_type=code&scope=identify&state=…`
- Plain login: passport-discord's default `authorizationURL`
  (`node_modules/passport-discord/lib/strategy.js:45`), scope `identify`
  (`api/src/plugins/discord/discord-auth.strategy.ts:81`).
- Invite and link: `buildOAuthUrl` (`discord-auth.controller.ts:156-162`).
- Silent re-auth: same URL plus `&prompt=none` (`discord-auth.helpers.ts:142-162`).
- Discord answers `/api/oauth2/authorize` with a **302 to `/oauth2/authorize`** (checked with curl,
  dummy client id). So the phone makes two hops away from our site: ours → `/api/…` → `/oauth2/…`.

**State.** Signed HMAC-SHA256 JSON with the JWT secret (`discord-auth.helpers.ts:184-191`),
carrying `action`, `timestamp` and a random `r` (`discord-login-state.helpers.ts:46-57`).
`sha256(r)` goes in an httpOnly cookie `rl_link_state_discord-login`, SameSite=Lax, path `/`,
Secure when the request is https, 10-minute life (`link-state-cookie.helpers.ts:38-62`,
`browser-bound-cookie.helpers.ts:19-30`).

**Callback.** `GET /auth/discord/callback` (`discord-auth.controller.ts:91-117`). Before the code
exchange the strategy checks signature, 10-minute age, action, and **that this browser holds the
state cookie** (`discord-login-state.helpers.ts:60-86`). A missing cookie fails as
"state not bound to this browser" → `/login?error=oauth_failed` (`discord-auth.helpers.ts:116-140`).

**Session hand-over.** The callback mints a 30-second one-time code (Redis) bound to the browser by
cookie `rl_auth_code` (`auth-code-cookie.helpers.ts:20-40`), sets the refresh cookie, and 302s to
`/auth/success?code=…`. The SPA swaps the code for an access token held **in memory only**
(`web/src/lib/api/access-token-store.ts:10`). Both steps need the **same browser** throughout.

**Session length.** Access token 1 hour (`access-token-mint.helpers.ts:24`). Refresh cookie `rl_rt`:
httpOnly, SameSite=Strict in production, lifetime = admin setting "session length", **default 60
days**, range 1–365 (`refresh-cookie.helpers.ts:24-36`, `settings-session.helpers.ts:10-28`).
It rotates on use, so an active member stays signed in well past 60 days.

**Silent re-auth.** When refresh fails and localStorage says the last sign-in was Discord, the SPA
sends the browser to `/auth/discord/silent` (`prompt=none`) once per 10 minutes
(`web/src/lib/api/silent-reauth.ts`). It only works if the **browser** still has a Discord web
session; otherwise Discord returns an error and the member sees our login page.

**Mobile special cases.** None. No user-agent, in-app-browser or platform check in the sign-in path.

**Magic link.** One-time sign-in links exist for Discord → web hops (`api/src/auth/magic-link.service.ts`,
redeemed by `POST /auth/redeem-magic-link`), used by the bot today (e.g. `lfg-composer-link.helpers.ts`).

## What Discord and the phone platforms do

1. **iOS Universal Links — CONFIRMED (fetched file).** `https://discord.com/.well-known/apple-app-site-association`
   claims `/app`, `/invite/*`, `/channels/*`, `/connect/authorize`, `/login/one-time`,
   `/mweb-handoff`, `/activate` and others. For `/oauth2/authorize` it has two rules: **exclude** when
   `response_type` is present ("Exclude oauth2 flows that have a specified response type from deep
   linking"), otherwise deep link ("one of our add app flows"). `/api/oauth2/authorize` is not
   claimed at all. So on iOS a code-flow sign-in never opens the app, whatever we do with the URL.
2. **Android App Links — PARTLY CONFIRMED.** `https://discord.com/.well-known/assetlinks.json`
   grants package `com.discord` `handle_all_urls` and `get_login_creds`. Which paths the app
   claims is in its manifest, which we did not inspect. Whether it takes `/oauth2/authorize?response_type=code`
   is **UNKNOWN**.
3. **Official docs — CONFIRMED.** Discord's web OAuth2 docs describe only an https browser flow.
   The app hand-off Discord documents is for the **Social SDK in native games**: it deep-links into
   the installed app, needs PKCE and a custom-scheme redirect `discord-<APP_ID>:/authorize/callback`,
   and falls back to a browser when the app is missing. Nothing applies it to a website in a phone
   browser.
4. **`discord://` scheme — UNKNOWN / not documented.** The SDK docs only name the `discord` scheme
   for an install check. No documented `discord://…oauth2/authorize` form for web sites. Using an
   undocumented scheme would break silently on any app update; if the app is missing, iOS shows an
   "invalid address" error.
5. **Platform hand-off rules — REPORTED.** iOS: Universal Links fire on a user tap; server or JS
   redirects are often suppressed, with regressions reported on iOS 17/18 (Apple developer forum
   threads). Android Chrome: no app launch without a user gesture; a gesture is honoured through a
   redirect chain for a limited time (Chrome intents doc, Chromium `external_intents`). Typed URLs do
   not hand off.
6. **The way back — UNKNOWN.** No source says where the Discord app opens an https `redirect_uri`
   after "Authorize": default browser, the browser that started, or its in-app browser. An old iOS
   bug (discord-api-docs #6160, 2023, fixed) shows the app opening the redirect in its **in-app
   browser**. Any of those except "the same browser" loses our state cookie and fails.
7. **Alternatives on Discord's side — CONFIRMED (Discord help centre).** The web login page offers
   QR-code login (scan with the phone app — useless when the web page **is** on that phone) and
   passkey login. A member with a passkey on their phone can sign in to Discord's web page without a
   password.

## Options

**1. Make Discord rarely needed (recommended).** S, no auth-flow, contract or migration change.
- iPhone/Android: signs in once with Discord in the browser, then stays signed in for the session
  length (60 days default, rolling).
- Change: confirm the admin session length; add a short phone-only hint on the login page ("Use the
  same browser each time. Tip: add a passkey to Discord to skip the password.");
  `web/src/pages/login-page.tsx`.
- Risk: none to security. Does not help a member whose browser wipes storage.

**2. Magic link from Discord as the phone path.** M, touches auth entry (reuses the existing
magic-link service), no migration.
- Member taps "Sign in from Discord" → the bot DMs a one-time link → tapping it signs them in. The
  Discord app is the identity proof; no Discord password.
- Risk: the link opens in Discord's in-app browser unless the member has set "open links in
  external browser", so the session may land in the wrong browser. Needs a way to trigger the DM
  (slash command, or a button that asks for the Discord username).
- Unverified: which browser Discord opens DM links in on each platform.

**3. Android-only hand-off attempt.** S, auth-flow change (authorize URL host/path).
- Point straight at `https://discord.com/oauth2/authorize` (skip the `/api` hop) so the tap goes
  to one fewer redirect. On iPhone nothing changes (AASA exclusion).
- Risk: the return lands in another browser and fails with `oauth_failed` — worse than today.
- Unverified: whether the Android app claims the URL at all. Only worth it if the experiment passes.

**4. `discord://` custom scheme — reject.** Undocumented, breaks with no app installed, and the
return path problem is the same.

## Recommendation and the 5-minute experiment

Build **Option 1** now. Treat Option 2 as a follow-up if members still complain. Do not build 3 or 4
unless the experiment below passes on Android.

**Experiment (operator's own phone, no code change).**
1. In the Developer Portal note `<CLIENT_ID>` and the registered `<REDIRECT_URI>`.
2. Build, on a laptop: `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code&scope=identify&redirect_uri=<URL-ENCODED REDIRECT_URI>`
   (no `state`, so our callback will reject it — that is expected and harmless).
3. Send it to the phone in a notes or messaging app (not the Discord app) and **tap** it, with the
   Discord app installed and signed in.
4. Record: did the Discord app open with an "Authorize" screen? After Authorize, which app opened the
   redirect? (Our login error page in Chrome/Safari/in-app browser tells you where it landed.)
5. Repeat with the URL **without** `&response_type=code` — on iOS this should open the app (the AASA
   "add app" rule), which confirms the reading of the file.

Pass = Android opens the app on step 3 **and** the redirect lands in the browser that would hold the
cookie. Anything else kills Options 3–4.

## Device test matrix

Expected results. "Browser login" = Discord's web email/password page. "Signed in" = back on our
site with a session.

| Device / browser | Discord app | Today | Opt 1 | Opt 2 | Opt 3 |
|---|---|---|---|---|---|
| iPhone Safari | installed, signed in | browser login | browser login once, then stays in | DM link → signed in (browser that opens it) | same as today |
| iPhone Safari | installed, signed out | browser login | as left | no DM possible → browser login | same as today |
| iPhone Safari | not installed | browser login | as left | n/a | same as today |
| iPhone Chrome | any | browser login (WebKit, own cookies) | as Safari | as Safari | same as today |
| Android Chrome | installed, signed in | browser login | once, then stays in | DM link → signed in | UNKNOWN: app may open; return may fail |
| Android Chrome | installed, signed out | browser login | as left | browser login | app login screen, or browser |
| Android Chrome | not installed | browser login | as left | n/a | browser login |
| iPad Chrome | any | browser login | as iPhone | as iPhone | same as today |

## Why "every time"?

The code says our session should **not** end often: a 60-day rolling refresh cookie (default), and
silent re-auth through Discord when it does. So a member asked for a password **every** time is
almost certainly losing **browser storage**, not hitting our expiry. Likely causes:
- Private/incognito tab, or a browser set to clear cookies on exit.
- Opening our links from inside Discord or another app: those open an in-app browser that does not
  share cookies with Safari/Chrome and may be discarded each time.
- Switching browsers (link opens in Chrome one day, Safari the next).
- Discord's own new-location check means its web session never sticks in that browser either, so
  silent re-auth also fails.
- An admin set session length to a few days (check the setting).

Ask the member: which browser and device; do they open us from a link inside Discord or from a home
screen bookmark; private mode on; does Discord's own web site keep them signed in in that browser;
roughly how long between sign-ins.

## Open questions

- Which paths the Android Discord app claims (needs the APK manifest or the experiment).
- Where the Discord app opens an https `redirect_uri` after Authorize, per platform.
- What Discord's `/mweb-handoff` and `/login/one-time` paths do — undocumented; not for third parties.
- Our production session-length setting.
- Which browser Discord opens DM links in (affects Option 2).

## Sources

- Discord iOS association file (fetched 2026-11-20): https://discord.com/.well-known/apple-app-site-association
- Discord Android asset links (fetched 2026-11-20): https://discord.com/.well-known/assetlinks.json
- Discord OAuth2 docs: https://docs.discord.com/developers/topics/oauth2
- Discord Social SDK, account linking on mobile: https://docs.discord.com/developers/discord-social-sdk/development-guides/account-linking-on-mobile
- iOS in-app browser redirect bug: https://github.com/discord/discord-api-docs/issues/6160
- QR-code login (Discord help): https://support.discord.com/hc/articles/360039213771
- Passkeys (Discord help): https://support.discord.com/hc/articles/25966860846231
- Universal Links and redirects (community): https://developer.apple.com/forums/thread/826689 , https://developer.apple.com/forums/thread/780496 , https://developer.apple.com/forums/thread/747131
- Android intents in Chrome (user-gesture rule): https://developer.chrome.com/docs/android/intents , https://chromium.googlesource.com/chromium/src/+/main/components/external_intents
- `/api/oauth2/authorize` → 302 `/oauth2/authorize`: curl with a dummy client id, 2026-11-20.
