# RL Companion dev bridge — v1

**Owner: Raid Ledger** (story ROK-2055). rl-companion (the `/dev/v1/*`
listener) and the dev-only **LedgerLinkProbe** addon pin a copy of this folder
and validate against it in their own CI. Only a Raid Ledger PR touching this
folder changes the format. If this prose and the Zod source disagree, **the Zod
source wins** and the prose is the bug.

- Zod source: `packages/contract/src/companion-dev-bridge.schema.ts` (probe
  request/result, primitives), `companion-dev-bridge-endpoints.schema.ts`
  (endpoint bodies), `companion-dev-bridge-allowlist.ts` (allowlist).
- Generated: `schema.json` (one `$defs` entry per body; the root accepts
  nothing) and `allowlist.json`. Regenerate from the repo root:
  `npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs`.
- Fixtures: `npm run build -w packages/contract && node packages/contract/scripts/gen-companion-dev-bridge-fixtures.mjs`.
- Guard: `packages/contract/src/__tests__/companion-dev-bridge-contract.spec.ts`.

This is **not** a companion-envelope message: it is not in
`COMPANION_CONTRACTS`, and the Raid Ledger server never sends or reads it. It
is a LAN-only side channel for development (agents reach it through
skeleton-key). Agent how-to: `docs/runbooks/dev-bridge.md`.

## Transport

- HTTPS (self-signed per install) on one RFC1918 IPv4 the operator picks,
  default port `47655`. Off by default.
- Every request carries `Authorization: Bearer rlcdev_<43 base64url>` and comes
  from an allowlisted address; otherwise 401/403 with an `error` body and no
  detail. The dev token (`rlcdev_…`) and the device token (`rlcd_…`) are
  unrelated and never interchangeable.
- Every response body, serialised, is **≤ 16 KiB** (`DEV_BRIDGE_PAGE_MAX_BYTES`).
  A list or text that would not fit is paged: the client passes `?cursor=` and
  the body carries `next` (an opaque cursor, or `null` on the last page).
  **A cursor is valid only on the route that issued it** — and, for
  `/dev/v1/addons/<folder>/sv`, only for that same `<folder>`. The companion
  answers a cursor from another route or folder with 400 `invalid_request`
  at `cursor`; the client restarts without one.
- **Every byte cap is UTF-8 bytes of the JSON serialisation**
  (`devBridgeJsonBytes`), never characters — escaping (`"`, `\n`, `\u0001`) and
  multi-byte text count. The schemas enforce each cap (a root-level `custom`
  issue). Producers page `sv-raw.text` by serialised bytes, and `error.issues`
  drops trailing issues to fit.

## Endpoints

| Method | Path | `$defs` body | Paged |
|---|---|---|---|
| GET | `/dev/v1/health` | `health` | no |
| GET | `/dev/v1/addons?flavor=&cursor=` | `addons` | yes |
| GET | `/dev/v1/ledgerlink/sv?flavor=&scope=account\|character&cursor=` | `sv-raw` | yes (text) |
| GET | `/dev/v1/ledgerlink/sv/parsed?flavor=&cursor=` | `sv-parsed` | yes |
| GET | `/dev/v1/addons/<folder>/sv?flavor=&scope=account\|character&cursor=` (`<folder>` in `DEV_BRIDGE_SV_READABLE_ADDONS`) | `sv-raw` | yes (text) |
| POST | `/dev/v1/probes` (body `probe-request`) | 202 `probe-queued` · 400/409 `error` | no |
| GET | `/dev/v1/probes?status=&cursor=` | `probe-list` | yes |
| GET | `/dev/v1/probes/:id?cursor=` | `probe-detail` | yes (`result.calls`) |
| DELETE | `/dev/v1/probes/:id` | `probe-cancelled` | no |
| GET | `/dev/v1/logs?since=&level=&cursor=` | `logs` | yes |
| GET | `/dev/v1/collectors` | `collectors` | no |
| GET | `/dev/v1/events?since=&cursor=` | `events` | yes |
| GET | `/dev/v1/ledgerlink/snapshot?flavor=&character=&at=&cursor=` | `ledgerlink-snapshot-page` | yes (`calls` → `apis` → `sections`) |
| GET | `/dev/v1/ledgerlink/snapshot/history?flavor=&character=&cursor=` | `ledgerlink-snapshot-history` | yes |
| GET | `/dev/v1/bg3/saves?cursor=` | `bg3-saves` | yes |
| GET | `/dev/v1/bg3/saves/<saveRef>/structure?cursor=` | `bg3-save-structure` | yes (`types` → `party`) |
| GET | `/dev/v1/bg3/install?cursor=` | `bg3-install` | yes (`paks`, by entry slice) |
| GET | `/dev/v1/bg3/saves/<saveRef>/catalogue?cursor=` | `bg3-save-catalogue` | yes (`party`) |

- `error.error` is one of `invalid_request` (400, carries `issues` — each
  `{ path, code, message }` as Zod reports it), `unauthorized` (401),
  `forbidden` (403), `rate_limited` (429, after 10 failed auths a minute),
  `not_found` (404), `probes_disabled` (409), `internal` (500, an
  unexpected companion failure while serving the request; code only, no
  detail — a companion may instead close the connection with no body).
- `sv-raw.path` and every other path are **relative to the configured WoW
  folder**, forward slashes, no `..`, no drive, no backslash. No endpoint
  accepts a filesystem path, URL, shell string or Lua.
- `sv-parsed` hashes GUIDs (`guidHash`, lowercase hex) and reports counts, not
  names. `sv-raw` returns the file text as-is (operator's own LAN tool).
- `probe-detail` pages a large result by **item** — a call result without its
  `iterations`, or one iteration. Each page repeats the other fields (summary,
  `request`, `error`) and carries the next items; a `forEach` call whose
  iterations span pages repeats its whole head — the call without
  `iterations` (`id`, `status`, and `values`/`error`/`truncated` when present,
  ≤ 3 KiB) — with the next slice of `iterations` (clients merge by call `id`,
  iterations by `i`). One page always fits: echoed request ≤ 4,057 B + call
  head ≤ 3 KiB + one iteration ≤ 3 KiB + the other fields at their maxima
  (120 × `€` title, 512 × `\u0001` error, 128-char `next`) is ≤ 14,132 bytes
  (`fixtures/probe-detail--max-page.json`; the fixture generator fails if it
  drifts), leaving 2,252 B of the 16 KiB page for longer timestamps.
- `probe-detail.request` is the probe **as queued**: output form (defaults
  filled), `flavor` the resolved folder it was written to (never `auto`), no
  `probeId` (the page carries it). Checked for shape only — NOT against the
  allowlist, so a stored probe stays readable after the deny list grows.
- `logs` lines are already redacted: a line holding `rlcd_…`, `rlcdev_…` or a
  bearer value other than exactly `<redacted>` is invalid, in any letter case
  (`bearer`, `BEARER`, `RLCDEV_`). The companion redacts with the same
  patterns before it stores a line — `(?i)bearer\s+\S+` → `bearer <redacted>`
  and `(?i)rlcd(ev)?_[A-Za-z0-9_-]+` → `<redacted>` — rather than relying on
  hand-written messages (so prose like "missing bearer token" becomes
  "missing bearer <redacted>").
- Probe `status`: `queued` → `answered` | `expired` (past `ttlHours`) |
  `rejected` (the stored result failed `probe-result`; `error` says why) |
  `cancelled` (after DELETE).

## Other addons' SavedVariables (`/dev/v1/addons/<folder>/sv`)

`GET /dev/v1/addons/<folder>/sv` returns one page of `<folder>.lua` in the
same `sv-raw` body as `ledgerlink/sv`, with the same paging, cursor and
error rules. `<folder>` must be one of `DEV_BRIDGE_SV_READABLE_ADDONS`
(`companion-dev-bridge-endpoints.schema.ts`, Zod enum
`DevBridgeSvReadableAddonSchema`; matched exactly and case-sensitively after
percent-decoding, so `!BugGrabber` and `%21BugGrabber` are the same folder):

| Folder | Saved variable | Why it is readable |
|---|---|---|
| `Mailworthy` | `MailworthyDB` (`selftest` holds the self-test report) | the operator's own addon |
| `!BugGrabber` | `BugGrabberDB` | holds only captured Lua errors |

**Why an allowlist.** Other addons' saved data can hold whispers and chat
history (EnhanceQoL's IM history, for one), so the bridge reads only addons
the operator owns or that hold only error reports. LedgerLink is not in the
list: it has its own route. Adding a folder is an **additive** change (stays
v1); removing one is breaking. Like `sv-raw` everywhere, the text is returned
as-is (operator's own LAN tool).

**Selection — the same for `ledgerlink/sv` and `addons/<folder>/sv`.**
`scope=account` reads `<flavor>/WTF/Account/<account>/SavedVariables/<file>.lua`;
`scope=character` reads
`<flavor>/WTF/Account/<account>/<realm>/<character>/SavedVariables/<file>.lua`.
`scope` defaults to `account` when omitted. There is no account, realm or
character parameter: of every file of that
scope under every account folder of the flavor, the companion serves the one
with the **newest mtime**. Symlinked files are not followed. `path` names the
file served, relative to the WoW folder. The cursor pins that file's length
+ mtime; a file rewritten mid-paging is a 400 `invalid_request` at `cursor`,
and the client restarts without one.

**Errors.** A folder not in the list → 404 `not_found`, checked before any
query parameter (never 403 or 400, so the response reveals nothing about
folders outside the list). A listed folder
with no SavedVariables file of that scope → 404 `not_found`. A bad `scope`
or `flavor` → 400 `invalid_request`, as on every other route.

## Collector status (`collectors[].status`, `linked`) — 2026-11-06

Each `collectors` row may carry `status`, the Companion window's collector
tile status line as a closed enum. The body may carry `linked`, whether this
device holds a device token. Linking is **device-level** (one token, one
server URL per device), so `linked` is one top-level field, never per row: an
unlinked device puts every enabled row on `link-device`
(fixture `collectors--unlinked`; a row-level `linked` is invalid,
`invalid/collectors--row-linked`). Both are **optional** (additive): a body
from a companion built before 2026-11-06 omits them and still parses
(fixture `collectors--without-status`). A device-level state that blocks
every collector replaces the collector's own line, in the order `paused` >
`rate-limited` > `link-device` > `error` (the device token cannot be read) —
what the window shows once for the device.

| Value | Meaning (tile copy it stands for) |
|---|---|
| `off` | The collector is switched off ("Off", "<Game> uploads are off", "Uploads switched off — uploaded N of M"). |
| `paused` | The device is paused ("Paused — uploads resume when you unpause"; also a batch cut short by a pause). |
| `rate-limited` | The server answered 429; uploads are held and retried automatically ("Rate limited — retrying …"). |
| `link-device` | The device is not linked, or its token was refused and it must re-link ("Link this device to upload", "Re-link this device"). |
| `not-scanned` | Switched on, no scan has finished yet ("Waiting for the first scan…"). |
| `no-files` | The scan found nothing to read in the folder (the collector's no-files hint). |
| `needs-confirm` | Items are held until the user checks the preview and confirms the first upload ("N waiting — check the preview before the first upload"). |
| `waiting` | Items are queued but not sent this pass ("N export(s) waiting"). |
| `up-to-date` | Nothing new to send ("Up to date"). |
| `uploaded` | The last pass ended "Uploaded N of M export(s)" with **N ≥ 1** — at least one upload was accepted. |
| `rejected` | The batch was stopped by a content refusal that is not resent — today only the hub's Gallery being full (`blob_quota_exceeded`). Other refusals do not stop the batch; they show as `upload-rejected` events. |
| `retrying` | The batch was stopped by a deferral (the server does not take the upload yet, or an unexpected answer): "Will retry: …". |
| `error` | Anything else that stops the collector (e.g. the device token cannot be read, the server URL is unusable). |

**How a finished pass maps.** rl-companion's upload pass ends with
"Uploaded N of M export(s)" even when N is 0 (every item gave up after its
retries, or was a content refusal that does not stop the batch). So:

- N ≥ 1 → `uploaded`.
- N = 0 → what the tile's state implies: `waiting` while exports are still
  unsent (given-up items are retried on the next scan, so `pending` > 0),
  `up-to-date` when nothing is left (every item was settled by a refusal).
- A batch cut short maps by what stopped it: a pause → `paused`, the
  collector switched off → `off`, 401 → `link-device`, 429 →
  `rate-limited`, a full Gallery → `rejected`, a deferral → `retrying`.

The enum carries no free text; the tile's wording, paths and reasons stay
in the app. A new value is **breaking** for readers that switch on it, so it
needs a new `vN/` (or an operator ruling that the value is additive).

## Activity events (`GET /dev/v1/events`, `events`) — 2026-11-06

Structured companion activity, the allowlisted replacement for the removed
Activity-log mirror. **No free text anywhere**: every field is a timestamp,
a collector id, an enum or an integer — never a message, path, file, account, character or
save name (four review rounds found path leaks in free-text scrubbing; the
log mirror was removed for that reason). Rows are strict objects: an
unknown key such as `message` is invalid (fixture
`invalid/events--free-text-message`).

| Field | Type | Notes |
|---|---|---|
| `ts` | timestamp (UTC, ≤24 chars) | When it happened. |
| `collectorId` | `^[a-z0-9][a-z0-9-]{0,63}$` | Same grammar as `collectors[].id`: a code-defined built-in collector id (`wow-ledgerlink`, `bg3-save`, `bg3-screenshot`, …), never user data. |
| `kind` | enum below | What happened. |
| `count` | int 0–1,000,000, optional | Files scanned, exports uploaded or held. |
| `httpStatus` | int 100–599, optional | The server's status, for an upload outcome. |
| `errorCode` | enum below, optional | Why an upload was refused or deferred. |

| Value | Meaning |
|---|---|
| `scan` | A scan pass finished (`count` = files read). |
| `upload-ok` | An upload was accepted (`count` = exports, `httpStatus` 2xx). |
| `upload-rejected` | The server refused the content; not resent (`httpStatus` 4xx, `errorCode` = its `code`). |
| `upload-held` | Uploads are held after a 429 (`httpStatus` 429, `count` = exports held). |
| `upload-retry` | A transient failure; retried on a later scan (`httpStatus` when the server answered). |
| `link-required` | The device token is missing or was refused (`httpStatus` 401 when refused). |
| `collector-on` | The user switched the collector on. |
| `collector-off` | The user switched the collector off. |
| `error` | Anything else that stopped the pass (`errorCode` says which). |

**`errorCode`** (`DEV_BRIDGE_EVENT_ERROR_CODES`) — the codes rl-companion's
upload paths can act on (`apps/companion/src-tauri/src/upload.rs`):

| Value | Source |
|---|---|
| `invalid_envelope` | Server content rejection, terminal (`TERMINAL_CODES`). |
| `invalid_payload` | Server content rejection, terminal (`TERMINAL_CODES`). |
| `payload_too_large` | Server content rejection, terminal (`TERMINAL_CODES`). |
| `captured_at_in_future` | Server content rejection, terminal (`TERMINAL_CODES`). |
| `blob_quota_exceeded` | The hub's Gallery is full (413); stops the batch. |
| `invalid_blob` | Server refused a blob PUT. |
| `hash_mismatch` | Server refused a blob PUT. |
| `unsupported_media` | Server refused a blob PUT. |
| `blob_ref_mismatch` | Server refused a blob PUT. |
| `blob_refused` | The companion's own: a blob PUT refused (4xx) with no `code`. |
| `unknown_contract` | Deferred: the server does not take this contract yet. |
| `unknown_contract_version` | Deferred: the server does not take this contract version yet. |
| `retired_contract_version` | Deferred: the app is out of date. |
| `other` | Anything else. |

Mapping rule: the companion sends the server's `code` only when it is in the
list; every other code (one the app does not know, an uppercase API code such
as `USER_DEACTIVATED`) is sent as `other`, as is a kind-`error` event. A
refused message with no `code` omits `errorCode` (`httpStatus` still says
what happened). A 401 and a 429 carry no code: `link-required` and
`upload-held` with `httpStatus` say it. A new code is breaking for pinned
readers, like a new `status`.

Events come oldest first. `since` (a timestamp) returns events with `ts`
after it; paging is by the 16 KiB body cap alone — no row count limit (with
every field at its widest, 76 rows fit — fixture `events--max-page`). How many events the
companion retains is its choice; a cursor whose event was dropped is a 400
`invalid_request` at `cursor`. A new `kind` value is breaking for the same
reason as a new `status`.

## Probe request (`probe-request`)

```json
{ "title": "Can an addon read professions?", "flavor": "auto", "after": "PLAYER_LOGIN", "ttlHours": 72,
  "calls": [
    { "id": "profs", "fn": "GetProfessions" },
    { "id": "n", "fn": "GetNumSkillLines" },
    { "id": "skill", "fn": "GetSkillLineInfo", "args": ["$i"], "forEach": { "countFrom": "n", "max": 60 } },
    { "id": "ts", "presence": "C_TradeSkillUI" } ] }
```

- `title` 1–120 chars, no control/bidi characters. `flavor` `auto` (default:
  the flavor LedgerLink SavedVariables was last seen in) or a flavor folder
  name. `after` `PLAYER_LOGIN` (default) | `PLAYER_ENTERING_WORLD` |
  `GUILD_ROSTER_UPDATE`. `ttlHours` 1–168 (default 72). `calls` 1–40.
- The request's **largest derived form** — output form (defaults filled) plus
  a 26-char `probeId`, with `flavor` replaced by a 34-char folder name (the
  longest `_[a-z0-9_]{1,32}_` allows) — serialised, is **≤ 4 KiB**
  (`DEV_BRIDGE_PROBE_REQUEST_MAX_BYTES`, `devBridgeProbeRequestWorstBytes`).
  POST, the Queue.lua entry and the `probe-detail` echo all measure that same
  form, so a request the bridge accepts always fits as a queue entry and as
  an echo whatever flavor it resolves to. In practice a POST body with
  `flavor: "auto"` is ≤ 4,027 B (`fixtures/probe-request--max-size.json`;
  its queue entry, `fixtures/probe-queue--max-entry.json`, is exactly 4,096 B).
- Each call has an `id` (unique, `^[A-Za-z][A-Za-z0-9_]{0,31}$`) and **exactly
  one** of `fn` (call it) or `presence` (report `type()` of the path; nothing
  is called, takes no `args`/`forEach`).
- `fn` / `presence`: 1–3 dot-separated identifiers. `fn` must pass
  `allowlist.json` (below); the issue path is `calls.N.fn`.
- `args`: ≤8 literals — string ≤128, finite number, boolean, `null`, or `"$i"`
  (the loop index; only valid with `forEach`). No tables, no functions.
- `forEach.countFrom` names an **earlier** `fn` call whose first return value
  is a number; the call runs for `$i` = 1..min(that, `max`), `max` ≤ 200.

## Allowlist (`allowlist.json`)

Both rl-companion (on POST) and LedgerLinkProbe (before each call) apply the
same table. **Deny wins.** Words come from the `tokenizer` rule (camel-case +
`_` split; `GetCVar` → `Get`,`C`,`Var`).

1. Grammar: ≤ `maxSegments` segments, each matching `segmentPattern`.
2. Denied when any word of any segment is in `denyWords`, any segment holds
   both words of a `denyWordPairs` entry, or any segment equals a `denyExact`
   name (case-insensitive) — e.g. `GetQuestReward`, which completes a quest.
3. Otherwise allowed only when the **first word of the last segment** is in
   `allowPrefixes` (`Get`, `Is`, `Has`, `Can`, `Unit`, `Num`; case-sensitive,
   so `Cancel…`/`Isolate`/`getfenv` do not qualify) **and that segment holds
   no `_`** (FrameXML handlers such as `UnitPopup_OnClick` are refused; real C
   API leaf names never hold one), or the **whole path** is in `allowExact`
   (so `time` is allowed, `SomeAddon.time` is not).
4. `redact`: listed 1-based return slots (officer note of
   `GetGuildRosterInfo`) are replaced by `replacement` before storing.
5. `examples.allowed` / `examples.denied` are shared test vectors every
   implementation must agree on. `examples.denyListed` all start with a read
   prefix, so only the deny rules refuse them — one per `denyWords` /
   `denyExact` entry; an implementation without a deny list fails them.
   `examples.tokenizer` pins the word split (`segment` → `words`), including
   acronym runs, digits and `_`.
6. `denyWordPairs` is currently subsumed by `denyWords` (every pair word is
   denied alone); it stays so a future pair whose words are harmless alone
   needs no shape change. Implementations still apply it.
7. Whole-word denies refuse some harmless reads, e.g. `GetTradeSkillInfo` /
   `GetNumTradeSkills` (`trade`) and `IsAddOnLoadOnDemand` (`load`). Use
   `presence`, or ask for an `allowlistVersion` change; do not spend a POST
   discovering it.
8. `allowlistVersion` bumps whenever any list changes. Adding a deny word or
   `denyExact` name stays in v1 (deny wins on either side, so mixed pins stay
   safe); removing one, or adding an allow prefix, needs an operator ruling.

## Probe result (`probe-result`)

What LedgerLinkProbe stores as a JSON string in
`LedgerLinkProbeDB.results[probeId]`, and what `probe-detail.result` carries.

- `{ probeId, capturedAt, addonVersion, calls, truncated }`; each call
  `{ id, status: ok|missing|error|denied, values?, error?, iterations?, truncated? }`;
  a `forEach` call reports `iterations: [{ i, status, values?, error? }]`.
- Values: leaves (string ≤512, number, boolean, null) or Lua tables as JSON
  arrays/objects, nested **at most 3 deep**, ≤40 entries per table, ≤40 return
  values per call. `presence` reports `values: ["<lua type>"]`.
- The whole serialised result is ≤ 64 KiB (`DEV_BRIDGE_PROBE_RESULT_MAX_BYTES`)
  and each item — a call result without `iterations`, or one iteration — is
  ≤ 3 KiB (`DEV_BRIDGE_RESULT_ITEM_MAX_BYTES`). To meet them the addon cuts
  trailing values, trims `error` (a 512-char error can escape to 3,074 B),
  and drops a lone value that is still too big (`values: []`), setting
  `truncated` on the call and the result. Its byte count must escape exactly
  as `devBridgeJsonBytes` does (`JSON.stringify` then UTF-8): raw UTF-8 for
  non-ASCII, `\"` `\\` `\n` `\r` `\t` `\b` `\f` short escapes, `\u00XX` for
  every other control character. An encoder that writes controls raw
  under-counts.
- A `forEach` call's top-level `status` is `ok` when `countFrom` returned a
  number (its own `values` omitted, per-index outcomes in `iterations`), and
  `error` with no `iterations` when it did not.

## Queue file (data, never code)

rl-companion writes `<flavor>/Interface/AddOns/LedgerLinkProbe/Queue.lua` as
the single assignment `RaidLedgerProbeQueue = [==[<JSON>]==]`, choosing the
long-bracket level so the JSON cannot close it, written atomically (temp +
rename). The JSON is `$defs/probe-queue`:
`{ "queueVersion": 1, "probes": [ … ≤50 … ] }`, oldest first. Each entry is the
POST body in **output form** (`title`, `flavor`, `after`, `ttlHours`, `calls` all
present), `flavor` resolved to the folder the file sits in (never `auto`),
plus the companion-assigned `probeId`; the allowlist and the 4 KiB request cap
(measured as above, so any accepted POST fits) apply. `fixtures/probe-queue.json` carries an arg holding `]]`, `]==]`, a
quote, a backslash and a newline.

## LedgerLink dev snapshot (`ledgerlink-snapshot`) — ROK-2072

**Where it lives.** Only while the operator has typed `/rl dev on`, LedgerLink
keeps `LedgerLinkDB.dev = { v = 1, enabledAt = <unix s>, snapshots = { [<guid>]
= "<JSON>" } }` in the account-wide SavedVariables file and rewrites the
current character's entry on every `PLAYER_LOGOUT` (`/reload`, logout, exit).
Each value is ONE JSON string that validates against `$defs/ledgerlink-snapshot`
(input mode — the companion receives it). `/rl dev off` (and the default)
leaves no `dev` key at all. At most 10 characters are held.

**Privacy (D3/D4).** The snapshot itself carries no name, realm, guild or
GUID: `character` is `{ class, level, faction, inGuild }` only, and
name-bearing calls (`UnitGUID`, `GetUnitName`, `UnitFullName`, `UnitName`,
`GetRealmName`, `GetNormalizedRealmName`, `GetGuildInfo`, `GetGuildRosterInfo`,
`GetGuildRosterLastOnline` — `DEV_BRIDGE_SNAPSHOT_NAME_BEARING_FNS`, mirroring
LedgerLink `Probe.NAME_BEARING`) appear in `calls` **only** as
`status: "presence"` with the Lua `type` and no `values`; any other status for
one of them is rejected at that call.
**No string or table key anywhere may match a player GUID**
(`Player-<1–5 digits>-<8 hex>`); the addon scrubs GUIDs out of section text
before storing. The companion derives `characterKey = sha256_hex(guid)` from
the table key — the same value as `sv-parsed` `outbox[].guidHash` — so no
response ever holds the GUID.

**Content.** `client` (`GetBuildInfo`, the addon's TOC interface, locale, raw
region), `ruleset` (the `Enum.GameRule` members discovered by `pairs()`, ≤ 64,
each with `C_GameRules.IsGameRuleActive(value)`; LedgerLink's own ruleset
answer), `calls` (`/rl probe` S1, structured), `apis` (S2 + the watched list,
presence only, unique, sorted by path) and `sections` (the `/rl probe` text of
S3 and S9; `skipped` when the 50 ms logout time guard ran out).

**Caps** (UTF-8 bytes of the JSON serialisation, as everywhere here): each
`calls` / `apis` / `sections` item ≤ 3 KiB; the head (the snapshot minus those
three arrays) ≤ 4 KiB; the whole snapshot ≤ 48 KiB
(`fixtures/ledgerlink-snapshot--max-size.json` sits exactly on it). A section
holds ≤ 40 lines of ≤ 256 chars; the addon drops trailing lines (and sets
`truncated`) to fit.

**Paging (`ledgerlink-snapshot-page`).** Items are `calls[]` then `apis[]` then
`sections[]`; every page carries the row fields, the full head and the next
items that fit, and clients rebuild the snapshot by concatenating each array
across pages. A page's `snapshot` is a slice: the arrays may be empty and only
the GUID and presence rules apply to it. One page always fits: a 4 KiB head +
one 3 KiB item + every row field at its maximum is 7,766 bytes
(`fixtures/ledgerlink-snapshot-page--max-page.json`). The cursor encodes
`(snapshotId, itemOffset)`; a cursor whose row was pruned → 400 at `cursor`.

**History and dedupe.** The companion caches the latest snapshot plus 7 days
of history per flavor + `characterKey`, on local disk only — never uploaded to
Raid Ledger. `digest` is sha256 of the snapshot with `capturedAt` removed; a
capture whose digest equals the newest row's bumps that row's `lastCapturedAt`
and `seenCount` instead of adding a row (consecutive identical only, so A→B→A
keeps three rows). `ledgerlink-snapshot-history` lists rows newest first with
the patch-day signals (`clientVersion`, `clientBuild`, `interface`,
`missingApis` = count of `apis[].type === "nil"`, `activeRules`); its cursor
names the last returned `snapshotId`.

**The digest is opaque.** How the companion serialises the snapshot before
hashing (key order, number formatting, whitespace) is internal to the
companion and **not part of this contract**: clients may compare two `digest`
values for equality, but must never recompute one, and a companion release
may change the serialisation (old and new rows then simply differ once).

**Params + errors.** `flavor` as every endpoint; `character` (a
`characterKey`) is optional when the flavor has one cached character, else
400 at `character`; on `history` it is an optional filter. `at` = a
`snapshotId` from `history` (default: latest; unknown → 404). Nothing cached
(dev mode off, never saved, pruned) → 404 `not_found`. No new error code.

## BG3 save reads (`bg3-saves`, `bg3-save-structure`) — ROK-2077

Read-only views of what the `bg3-save` collector sees on the PC, so an agent
can check a NewAge decoder against real saves without the operator sending
files. Free tier (same token as every endpoint); every body ≤ 16 KiB.

**Redaction is enforced by the schema, not by convention.** Never a save or
character name, profile id, GUID, file or folder path, position, dialogue
line or image byte. Concretely:

- Every object is strict — an extra key (`name`, `position`, `path`, …) is
  `unrecognized_keys`.
- Identifier fields, by how far the shape alone protects them:

  | Field | Shape | Name-proof by shape? |
  |---|---|---|
  | equipment `slot` | closed enum of the 19 BG3 `ItemSlot` names (`Helmet`, `Breast`, `Cloak`, `MeleeMainHand`, `MeleeOffHand`, `RangedMainHand`, `RangedOffHand`, `Ring`, `Underwear`, `Boots`, `Gloves`, `Amulet`, `Ring2`, `Wings`, `Horns`, `Overhead`, `MusicalInstrument`, `VanityBody`, `VanityBoots`) | **yes** |
  | `statsId` | `^[A-Z][A-Z0-9]{1,5}_[A-Za-z0-9_]{1,57}$`, ≤ 64 (`ARM_Hat`, `WPN_Longsword_1`), or `null` | **mostly** — a bare name (`Astarion`) or a path does not fit; a name behind a fake 2–6 char prefix (`AB_Astarion`) would |
  | `types[].type` | a component record `[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+){2,}` (`core.v0.Level`, `game.stats.v3.StatsComponent`) or a bare enum `E[A-Z][A-Za-z0-9]{1,80}` (`EAbility`, `EResistanceType`), ≤ 128 | **mostly** — a bare or capitalised name does not fit; a lower-case dotted string (`tav.is.great`) or an `E`-prefixed name (`EAstarion`) would |
  | `classId`, `subclassId` | `^[A-Za-z0-9_.]+$`, ≤ 64 (`Wizard`, `EvocationSchool`) | **no** — a one-word name (`Tav`) fits. These rely on the companion emitting only values it read from game data. |

  `classId`, `subclassId` and `type` also reject a string that is all hex
  and ≥ 8 chars (`6f2b8c1e`, a GUID fragment), as `invalid_format`.
- **Values that do not fit are dropped, never rewritten.** An equipped item
  whose stats id does not match the `statsId` pattern (a modded item, e.g.
  `Shadowheart_Robe`) is sent with `statsId: null`. A class the companion
  cannot map to a Larian class id (a mod class known only by UUID) is left
  out of `classLevels`; it is never sent as a UUID fragment.

  None of them admits `/`, `\`, `:`, `-` or a space, so no path, dashed GUID
  or multi-word name fits any of them.
- No string value or object key anywhere in either body may hold:
  - a **GUID** (`custom`, "A GUID is not allowed in a BG3 dev-bridge body"):
    32 hex digits split 8-4-4-4-12 by `-`, `_`, `.` or nothing (braced or
    not), a Larian handle (`h` + 8 hex + `g` + 4 hex …), or any run of ≥ 32
    hex digits — also after every `-`, `_`, `.`, `{` and `}` is stripped, so
    a GUID split by separator runs of any length (`__`) is caught; the Larian
    handle check ignores case. A base64-encoded GUID and a truncated one
    (< 32 hex) have no detectable shape — accepted residuals that rely on
    the companion;
  - a **run of ≥ 10 decimal digits** (`custom`, "A run of 10 or more digits
    (a profile or platform id) is not allowed …") — SteamID64s, Larian
    profile ids. `saveRef` is exempt: its 12-hex pattern keeps a SteamID64
    out, but a 10–12 digit id would fit; `saveRef` relies on its HMAC
    derivation for that. The rule also rejects a 10-digit `gameVersion`
    segment (`4.1.1.1234567890`), which `bg3-save` allows; real builds are
    7 digits (`4.1.1.6758295`), so this is deliberate, not a bug.
- `saveRef` (`^[0-9a-f]{12}$`) is the first 12 lowercase hex chars of
  `HMAC-SHA256(key = a random per-install secret, message = the save's path
  relative to the save root)`. It is stable while the save keeps its path
  and cannot be reversed offline without the secret (a plain hash of a
  low-entropy save name could be). `campaignKeyPrefix` is the first 8 hex
  chars of the row's `bg3-save` `campaignKey` (`^[0-9a-f]{8}$`), so a row
  joins to the uploads it produced without exposing the full key.
- `saves[].saveRef` is unique within a page, and so is `party[].slot`;
  `equipment[].slot` is unique within one party row (`custom`, "Duplicate
  saveRef … in saves" / "Duplicate slot … in party" / "Duplicate slot … in
  equipment").
- **Cursor.** Both bodies use their own `next` grammar,
  `^p[1-9][0-9]{0,3}_(saves|types|party)_[0-9]{1,6}$` — page number,
  section, row offset (e.g. `p2_types_9`) — not the shared 128-char cursor,
  so no file or folder name fits. The cursor is an offset, never derived
  from a file or folder name. It is valid only against the same save
  contents: if the save was rewritten since the first page, the companion
  returns 404 `not_found` and the client restarts from the first page.

**`bg3-saves` rows** (one per `.lsv`, paged with `next`):
`saveRef`, `campaignKeyPrefix`, `campaignKeySource` (the `bg3-save` enum:
`save-folder` | `game-id` | `file-name`), `gameVersion` (the `bg3-save`
pattern, or `null`), `savedAt` (ISO datetime or `null`), `partySize` and
`nonSummonCount` (0–16 or `null`), `clientCount` (meta.lsf
`ClientDatas/ClientData` count — the co-op hint; `null` when meta.lsf is
unreadable), `lsfVersions` (`{ meta, globals }` — the LSF format version of
`meta.lsf` and `Globals.lsf`, 1–255, `null` when absent or unreadable),
`newAgeBytes` (size of the NewAge blob, `0` when there is none), and
`fallbackReason`:

| `fallbackReason` | Meaning |
|---|---|
| `null` | Full read; no fallback. |
| `no-newage` | `Globals.lsf` has no `NewAge` blob. |
| `newage-unreadable` | The blob is not a readable LSMF. |
| `lsf-unreadable` | An LSF file failed to parse. |
| `meta-missing` | The save has no `meta.lsf`. |

`fallbackReason` and `decoder` are closed enums: a new value is
**breaking** (a v1 validator rejects it) and needs a new `vN/`. Adding an
equipment `slot` is the same — BG3 has 19 today, all listed.

**`bg3-save-structure`** (unknown `saveRef` → 404 `not_found`):

- `types[]` — the NewAge type table: `{ type, version, elementSize, count,
  decoder }`, `decoder` = `ok` (the companion decodes this exact
  `(type, version, elementSize)` triple), `unsupported` (a decoder exists but
  the triple differs — layout drift) or `none` (no decoder). Counts only,
  never element bytes.
- `checks` — `partyEntitiesFound`, `partyMatchesSaveInfo`, `portraitsFound`,
  `portraitsMapped`, `metaNamesMatchParty`, `ownerProfileMatchesLocal`: the
  S0 verification answers as counts and booleans (no name is compared in
  the body; only the outcome is reported).
- `party[]` — `{ slot, characterKeyPrefix?, decoded }` by 0-based party index.
  `characterKeyPrefix` (optional, ROK-2079 OQ-4; `^[0-9a-f]{8}$`, like
  `campaignKeyPrefix`) is the first 8 hex chars of the member's
  `characterKey = SHA-256(campaignKey ‖ ':' ‖ entityGuid)`, with entityGuid
  as lowercase hyphenated text — so a sweep can check that one entity keeps
  its key across saves of a campaign. Absent when the companion cannot derive
  it; the GUID itself is never on the bridge. Every `decoded`
  field is optional and absent when its decoder is `unsupported`/`none`:
  `abilities` (`str dex con int wis cha`, each 1–30), `proficiencyBonus`
  (1–10), `maxHp` (1–100,000), `classLevels[] { classId, subclassId|null,
  level 1–20 }` (≤ 12), `equipment[] { slot, statsId }` (≤ 19).

**Paging.** ~330 type rows do not fit 16 KiB, so the body is paged by
**row**: every page repeats `saveRef` and `checks`; the companion fills pages
with the remaining `types` rows first, then `party` rows, never splitting a
row, and sets `next` until both are exhausted. Each party row is checked
against `DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES` = 6 KiB (`custom`, "Party row
is N bytes; the cap is 6144"); the field caps already keep the worst row
well under it (the spec builds that row), so one always fits a page with
the head.

## BG3 game-data catalogue (`bg3-install`, `bg3-save-catalogue`, `collectors.bg3Catalogue`) — ROK-2081

Read-only views of the companion's BG3 catalogue — item / origin / quest
names it resolves from the player's own install (ROK-2081 ruling 6). Game-data
names (item names, rarities, origin names) **are** allowed on the LAN bridge
(ruling 7); custom character names never are — every object is strict, so a
`characterName` key is `unrecognized_keys`. Both new bodies carry the same
body-wide GUID / ≥ 10-digit guard as the ROK-2077 bodies, ≤ 16 KiB per page,
and their own cursor grammar `^p[1-9][0-9]{0,3}_(paks|party)_[0-9]{1,6}$`
(`p<page>_<section>_<offset>`). For `bg3-install` (`paks`) the offset is a
**flat** count of matched entries already returned, across every pak in pak
order — one pak's `entriesMatched` can span pages, so the offset is never a
pak index. For `bg3-save-catalogue` (`party`) it is the number of party rows
already returned. Like the ROK-2077 cursors it is an offset, never a file or
folder name.

**`collectors.bg3Catalogue`** (optional, body-level — not a collector row):
`{ state, reason, buildMs, builtAt, counts, lastLookup }`.

| `state` | Meaning | `reason` |
|---|---|---|
| `absent` | No usable install was found | `no-steam` · `no-bg3-library` · `no-app-manifest` · `no-data-dir` · `unsupported-store` · `other` |
| `indexing` | A build is running; the previous catalogue may still serve (ruling 9) | `null` |
| `ready` | Built; `buildMs`, `builtAt`, `counts` are non-null | `null` |
| `failed` | The last build failed (retried later) | `timeout` · `too-large` · `pak-error` · `parse-error` · `install-changed` · `cache-error` · `other` |

`reason` is set iff `state` is `absent`/`failed` and must come from that
state's list (`custom`). `other` is in both lists: the companion maps any
error kind it adds later to `other`, so a new companion-side kind needs no new
value here. `absent` has no catalogue, so `buildMs`, `builtAt`, `counts` and
`lastLookup` are all `null` (`custom` otherwise). `failed` (like `indexing`)
may keep them non-null: the previous catalogue is still served and they
describe it. `counts` = `{ items, origins, quests, waypoints,
skipped }`; `lastLookup` = `{ total, resolvedName, resolvedRarity, at }` of
the latest lookup batch (each resolved count ≤ `total`). `state`, `reason`
and the pak `method` / `store` enums are closed: a new named value is
**breaking** (for `reason`, unknown kinds go to `other` instead).

**`bg3-install`** (`GET /dev/v1/bg3/install`): `{ found, store, paks[],
next }`. `store` ∈ `steam` · `gog` · `epic` · `mac-app-store` · `unknown`
(a store, not a platform), and `store` is `null` iff `found` is `false`
(`custom`). `found: false` ⇒ `paks` is empty. Each pak: `rel` — relative to the
install's `Data/` folder, forward slashes, no `..`, no drive, ending `.pak`,
≤ 256 (the install path itself never leaves the PC); `parts` 1–16; and
`entriesMatched[]` (≤ 96 per page) of `{ name, sizeOnDisk, size, method,
part }` — the entry's path inside the pak (relative, ≤ 256), its compressed
and decompressed sizes, `method` ∈ `none` · `zlib` · `lz4` · `zstd` ·
`unknown`, and the archive part (0–15) holding it — always `< parts` of
its pak (`custom`). `paks[].rel` is unique
within a page; a pak whose entries span pages repeats its head (`rel`,
`parts`) with the next slice (clients merge by `rel`). Names and sizes only —
never pak bytes.

**`bg3-save-catalogue`** (`GET /dev/v1/bg3/saves/<saveRef>/catalogue`;
unknown `saveRef` → 404 `not_found`): `{ saveRef, catalogueState, hitRate,
party[], next }`. `party[]` = `{ slot, items[] }` by the same 0-based party
index as `bg3-save-structure`; each item `{ slot, statsId, name, rarity }` —
the equipment `slot` enum, the `bg3-save-structure` `statsId` pattern or
`null`, `name` (display text ≤ 128) or `null`, `rarity` (a Larian id ≤ 64,
e.g. `Legendary`) or `null`. A `null` name is a miss (a modded or unknown id)
— misses are listed by `statsId`. `items[].slot` is unique within a row and
`party[].slot` within a page. `hitRate` = `{ total, resolvedName,
resolvedRarity }` over the whole save, repeated on every page.
`catalogueState` `absent`/`failed` ⇒ every `name` and `rarity` is `null`
(`custom`). Each row is checked against
`DEV_BRIDGE_BG3_CATALOGUE_ROW_MAX_BYTES` = 12 KiB; a row of 19 items at
every field cap fits it and one page with the head.

## Fixtures

`fixtures/<message>.json` / `fixtures/<message>--<case>.json` parse with the
`$defs` entry the prefix names. `fixtures/invalid/EXPECTED.json` maps each
invalid case to the `{ path, code }` issue it must raise. All values are
synthetic; nothing from a real bridge is committed unless anonymised.
