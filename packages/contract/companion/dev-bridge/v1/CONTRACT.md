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
- `probe-detail` pages a large result by `result.calls`: each page repeats the
  other fields and carries a slice of the calls.
- `logs` lines are already redacted: a line holding `rlcd_…`, `rlcdev_…` or a
  `Bearer` value other than `<redacted>` is invalid.
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
   so `Cancel…`/`Isolate`/`getfenv` do not qualify) or the last segment is in
   `allowExact`.
4. `redact`: listed 1-based return slots (officer note of
   `GetGuildRosterInfo`) are replaced by `replacement` before storing.
5. `examples.allowed` / `examples.denied` are shared test vectors every
   implementation must agree on.

## Probe result (`probe-result`)

What LedgerLinkProbe stores as a JSON string in
`LedgerLinkProbeDB.results[probeId]`, and what `probe-detail.result` carries.

- `{ probeId, capturedAt, addonVersion, calls, truncated }`; each call
  `{ id, status: ok|missing|error|denied, values?, error?, iterations?, truncated? }`;
  a `forEach` call reports `iterations: [{ i, status, values?, error? }]`.
- Values: leaves (string ≤512, number, boolean, null) or Lua tables as JSON
  arrays/objects, nested **at most 3 deep**, ≤40 entries per table, ≤40 return
  values per call. `presence` reports `values: ["<lua type>"]`.
- The whole serialised result is ≤ 64 KiB (`DEV_BRIDGE_PROBE_RESULT_MAX_BYTES`);
  anything cut sets `truncated`.

## Queue file (data, never code)

rl-companion writes `<flavor>/Interface/AddOns/LedgerLinkProbe/Queue.lua` as
the single assignment `RaidLedgerProbeQueue = [==[<json array of pending
probe-request bodies, each with its probeId>]==]`, choosing the long-bracket
level so the JSON cannot close it, written atomically (temp + rename).

## Fixtures

`fixtures/<message>.json` / `fixtures/<message>--<case>.json` parse with the
`$defs` entry the prefix names. `fixtures/invalid/EXPECTED.json` maps each
invalid case to the `{ path, code }` issue it must raise. All values are
synthetic; nothing from a real bridge is committed unless anonymised.
