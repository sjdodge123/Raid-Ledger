# Companion dev-bridge — changelog

Additive changes (a new optional field a reader may ignore, relaxing a
refinement, ADDING a deny word or `denyExact` name with an `allowlistVersion`
bump) stay in `v1/`. Removing a deny entry or adding an allow prefix loosens
the safety net and needs an explicit operator ruling. Anything else is
breaking and gets a new `vN/` folder; rl-companion accepts the current and
previous version during the transition.

## v1 — 2026-11-06 (snapshot ruleset gains rppvp, additive)

- `ledgerlink-snapshot` `ruleset.ledgerLink.value` now reuses the shared
  WoW: Forever ruleset enum (`WowForeverRulesetSchema`) instead of a copied
  literal list, so it gains `rppvp` (RP-PvP realms, ROK-2101) alongside
  `normal`, `pvp`, `roleplaying` and `hardcore`. Relaxing an enum is
  **additive**: every existing body still parses. Without it a snapshot from
  an RP-PvP realm would fail to parse once LedgerLink emits `rppvp`.
  Fixtures unchanged.

## v1 — 2026-11-06 (collector status + structured events, additive)

- `collectors` rows gain an **optional** `status`, the Companion tile's
  status line as a kebab-case enum (`off`, `paused`, `rate-limited`,
  `link-device`, `not-scanned`, `no-files`, `needs-confirm`, `waiting`,
  `up-to-date`, `uploaded`, `rejected`, `retrying`, `error`; export
  `DEV_BRIDGE_COLLECTOR_STATUSES`), and the body an **optional** top-level
  `linked` (boolean; linking is device-level, so it is not per row). A body
  without them still parses (fixture `collectors--without-status`), so a
  companion that does not send them yet stays valid. **Additive for the
  server** — nothing in api/web parses these bodies. Rows and the body are
  `.strict()`, so a consumer pinned to the previous `schema.json` (e.g.
  rl-companion's own tests) rejects the new keys: consumers re-pin before
  the companion emits them.
- New route `GET /dev/v1/events?since=&cursor=`, new `$defs/events`
  (`DevBridgeEventsSchema`, `companion-dev-bridge-events.schema.ts`): strict
  rows `{ ts, collectorId, kind, count?, httpStatus?, errorCode? }`, `kind` from
  `DEV_BRIDGE_EVENT_KINDS`, `errorCode` from `DEV_BRIDGE_EVENT_ERROR_CODES`
  (the companion's upload codes, `other` for any other). No free text
  anywhere; ≤16 KiB per page (the only row bound), `next` cursor. A new route
  and a new `$defs` entry change no existing body.
- CONTRACT.md: a cursor is valid only on the route (and addons `<folder>`)
  that issued it — the companion already answers 400 `invalid_request` on a
  mismatch; now written down (#1956 review).
- Fixtures: `collectors` carries `status` + top-level `linked`; new `collectors--unlinked`, `collectors--without-status`,
  `events`, `events--empty`, `events--max-page`; invalid cases
  `collectors--unknown-status`, `collectors--linked-not-boolean`,
  `collectors--row-linked`, `events--unknown-error-code`,
  `events--free-text-message`, `events--error-code-sentence`,
  `events--unknown-kind`, `events--http-status-out-of-range`,
  `events--missing-next`, `events--over-size`. The `sv-raw` fixtures' `bytes`
  and `next` offsets now agree with their `text` (a last page's `bytes` is its
  text's size; a non-last page's cursor is `offset:<bytes served>`), and the
  account placeholder is `TESTACCOUNT` everywhere (was `ACCOUNTNAME` in the
  #1956 addon fixtures). `sv-raw--addon-mailworthy` is a last page
  (`next: null`): the whole file fits one page.
- **Additive** — stays v1.

## v1 — 2026-11-05 (addon SavedVariables reads, additive)

- New route `GET /dev/v1/addons/<folder>/sv?flavor=&scope=&cursor=`,
  body `sv-raw` (schema unchanged). `<folder>` must be in the new export
  `DEV_BRIDGE_SV_READABLE_ADDONS = ['Mailworthy', '!BugGrabber']` (Zod enum
  `DevBridgeSvReadableAddonSchema`); anything else, or a listed addon with no
  file, is 404 `not_found`. Other addons' saved data can hold whispers and
  chat history, so only addons the operator owns or that hold only error
  reports are readable; adding a folder to the list is additive.
- CONTRACT.md now spells out file selection for both raw routes: newest mtime
  among every file of the scope, no account/realm/character parameter (what
  `ledgerlink/sv` already did; previously undocumented).
- New golden fixtures `sv-raw--addon-mailworthy`, `sv-raw--addon-buggrabber`.
  `schema.json` changes only in the root `description` (names the route and
  the folders); no `$defs` change. **Additive** — stays v1.

## v1 — 2026-11-05 (ROK-2079 OQ-4 + ROK-2081 ruling 6, additive)

- `bg3-save-structure` party rows gain an optional `characterKeyPrefix`
  (`^[0-9a-f]{8}$`): the first 8 hex chars of `characterKey =
  SHA-256(campaignKey ‖ ':' ‖ entityGuid)`, so a sweep can compare one
  entity across saves. Optional — every existing body stays valid.
- `collectors` gains an optional body-level `bg3Catalogue` block
  (`state`, `reason`, `buildMs`, `builtAt`, `counts`, `lastLookup`), not a
  field on the strict collector rows. Optional — every existing body stays
  valid.
- New `$defs` (output mode, read-only routes): `bg3-install`
  (`GET /dev/v1/bg3/install` — pak names relative to `Data/`, parts,
  matched entries with sizes / method / part; never an absolute path) and
  `bg3-save-catalogue` (`GET /dev/v1/bg3/saves/<saveRef>/catalogue` — per
  equipped slot `{ slot, statsId, name, rarity }` plus the save's hit
  rate). Game-data names are allowed on the LAN bridge (ROK-2081 ruling 7);
  character names are not (strict objects). Both carry the BG3 GUID /
  10-digit guard and their own `p<n>_(paks|party)_<offset>` cursor.
- New golden fixtures `bg3-save-structure--character-keys`,
  `collectors--bg3-catalogue{,-absent}`, `bg3-install{,--absent,--entries-page}`,
  `bg3-save-catalogue{,--no-catalogue}`, and 22 invalid cases (each exactly
  one issue). Existing `$defs` change only by the two optional properties;
  the root `description` gains the new refinements. **Additive** — stays v1.
- Review fixes (same unreleased v1 change, still **additive** — no shipped
  body changes meaning): `bg3Catalogue.reason` gains the catch-all `other`
  in both the `absent` and `failed` lists, so a future companion error kind
  is not a new value; `state: absent` ⇒ `buildMs`, `builtAt`, `counts`,
  `lastLookup` all `null` (`failed` may keep the previous catalogue's);
  `bg3-install.store` value `mac` is `mac-app-store` (a store, not a
  platform) and `store` is `null` iff `found` is `false`; each matched
  entry's `part` < its pak's `parts`; the `paks` cursor offset is a flat
  count of matched entries across paks; the relative-path message no longer
  names the WoW folder. New invalid cases `collectors--bg3-catalogue-absent-with-counts`,
  `bg3-install--found-no-store`, `bg3-install--part-not-below-parts`.

## v1 — 2026-11-03 (ROK-2077, additive)

- New `$defs`: `bg3-saves` (`GET /dev/v1/bg3/saves`) and
  `bg3-save-structure` (`GET /dev/v1/bg3/saves/<saveRef>/structure`), both
  output mode — read-only, redacted views of the saves the `bg3-save`
  collector sees. Redaction is structural: strict objects, an equipment
  `slot` enum, a prefixed (or `null`) `statsId`, a dotted-record or
  `E`-enum `type`, unique equipment slots per party row, a BG3-only
  `next` cursor grammar, and a guard on every string and key against any
  GUID shape (dashed, `_`/`.`-split by runs of any length, braced, undashed,
  Larian handle in any case, ≥ 32 hex) and any run of ≥ 10 digits. New bodies no existing producer emits;
  no existing `$defs` entry changes (the shared cursor is untouched; only the
  root `description` gains the BG3 refinements). **Additive** — stays v1.
- New golden fixtures `bg3-saves`, `bg3-save-structure{,--unsupported,--types-page}`
  and 26 invalid cases in `fixtures/invalid/`, each raising exactly one
  issue (extra key on a save row or in `decoded`; GUID in `statsId` / `type`,
  `_`- and `__`-split, and as a Larian handle in either case; path or bare
  name in `statsId`; display name or 8-hex GUID fragment in `classId`; a
  17-digit id; free-text equipment `slot`; duplicate `saveRef` / party
  `slot` / equipment `slot`; folder-name `next` on both bodies;
  non-hex `saveRef`; ability out of range; unknown `fallbackReason`;
  missing `next`; both bodies over 16 KiB).

## v1 — 2026-11-03 (ROK-2072, additive)

- `ledgerlink-snapshot` refinement: a D4 name-bearing call
  (`DEV_BRIDGE_SNAPSHOT_NAME_BEARING_FNS`) must be `status: "presence"`; the
  snapshot `digest` serialisation is documented as companion-internal. Six more
  invalid fixtures pin the head cap, GUID-as-key, both presence/type rules,
  the GUID guard on a page slice and D4.
- New `$defs`: `ledgerlink-snapshot` (the dev snapshot LedgerLink stores per
  character under `/rl dev on`; input mode), `ledgerlink-snapshot-page`
  (`GET /dev/v1/ledgerlink/snapshot`) and `ledgerlink-snapshot-history`
  (`GET /dev/v1/ledgerlink/snapshot/history`). New bodies no existing
  producer emits; no existing `$defs` entry changes (only the root
  `description` gains the snapshot refinements). Stays v1.
- New golden fixtures `ledgerlink-snapshot--{minimal,forever,max-size}`,
  `ledgerlink-snapshot-page{,--max-page}`, `ledgerlink-snapshot-history`,
  `error--not-found`, and nine invalid cases in `fixtures/invalid/`.

## v1 — 2026-11-03 (ROK-2055, additive)

- `error.error` gains `internal` (500): an unexpected companion failure while
  serving the request. Code only, no `issues`. Additive — a new enum value no
  existing producer emits; stays v1. New golden fixture `error--internal.json`.

## v1 — 2026-11-02 (ROK-2055)

- Initial contract: the `/dev/v1/*` response bodies of the rl-companion dev
  bridge (health, addons, LedgerLink SavedVariables raw + parsed, probes,
  logs, collectors, errors), the probe grammar (`probe-request`) and the probe
  result the LedgerLinkProbe addon stores (`probe-result`).
- `allowlist.json`: the read-verb allowlist + deny list both rl-companion and
  LedgerLinkProbe apply, with shared example vectors.
- Generated `schema.json` (one `$defs` entry per body), golden fixtures and
  `fixtures/invalid/EXPECTED.json`.
- Review fixes before first release (ROK-2055 C1 review + Codex):
  - allowlist: a read-prefixed last segment holding `_` is refused (FrameXML
    handlers like `UnitPopup_OnClick`); `allowExact` matches the whole path;
    new `examples.denyListed` (read-prefixed, deny-only) and
    `examples.tokenizer` vectors.
  - `probe-queue` (`$defs`): the Queue.lua JSON.
  - byte caps enforced by the schemas: request ≤ 4 KiB, result item ≤ 3 KiB,
    result ≤ 64 KiB, every response body ≤ 16 KiB; `probe-detail` pages by item.
  - log redaction is case-insensitive.
  - `APPLY:` probe-detail pages by result item and caps each item at 3 KiB
    (the addon truncates) rather than adding a per-call page shape —
    reversible: raising a cap is additive.
  - `APPLY:` the request cap is 4 KiB of serialised output (≈30 full 128-char
    args) rather than lower per-field limits — reversible the same way.
  - `APPLY:` the 4 KiB request cap is measured on the request's largest
    derived form (output form + `probeId`, `flavor` padded to 34 chars) on
    POST, queue entry and echo alike, rather than giving the queue entry and
    echo extra headroom — one number, and any accepted POST fits Queue.lua and
    the probe-detail echo by construction. The echo carries the resolved
    flavor (never `auto`). Worst-case probe-detail page: 14,132 B. Reversible:
    raising the cap or switching to headroom is additive.
  - `APPLY:` the Queue.lua JSON is an object `{ queueVersion, probes }`
    (not a bare array) so the addon can detect a shape change; entries are
    output form with `flavor` resolved.
