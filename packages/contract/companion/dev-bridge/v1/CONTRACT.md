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
| POST | `/dev/v1/probes` (body `probe-request`) | 202 `probe-queued` · 400/409 `error` | no |
| GET | `/dev/v1/probes?status=&cursor=` | `probe-list` | yes |
| GET | `/dev/v1/probes/:id?cursor=` | `probe-detail` | yes (`result.calls`) |
| DELETE | `/dev/v1/probes/:id` | `probe-cancelled` | no |
| GET | `/dev/v1/logs?since=&level=&cursor=` | `logs` | yes |
| GET | `/dev/v1/collectors` | `collectors` | no |

- `error.error` is one of `invalid_request` (400, carries `issues` — each
  `{ path, code, message }` as Zod reports it), `unauthorized` (401),
  `forbidden` (403), `rate_limited` (429, after 10 failed auths a minute),
  `not_found` (404), `probes_disabled` (409).
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

## Fixtures

`fixtures/<message>.json` / `fixtures/<message>--<case>.json` parse with the
`$defs` entry the prefix names. `fixtures/invalid/EXPECTED.json` maps each
invalid case to the `{ path, code }` issue it must raise. All values are
synthetic; nothing from a real bridge is committed unless anonymised.
