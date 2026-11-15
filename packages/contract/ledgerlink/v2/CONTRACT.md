# LedgerLink ↔ Raid Ledger wire contract — v2

**Owner: Raid Ledger.** LedgerLink conforms. Neither side changes the format
unilaterally (§10). Story ROK-2184; every open question in its spec was ruled
by the operator on 2026-11-15 (Q1–Q10, cited below).

| What | Where |
|---|---|
| Payload source of truth (Zod) | `packages/contract/src/wow-addon-v2.schema.ts` (`AddonExportV2Schema`) + `wow-addon-loot.schema.ts` (`loot`); the char/guild/raid `data` shapes are the v1 ones in `wow-addon-export.schema.ts` |
| Header grammar, versions, limits | `wow-addon-v2.schema.ts` (`ADDON_IMPORT_PAGE_RE_V2`, `ADDON_EXPORT_ACCEPTED_VERSIONS`, `ADDON_IMPORT_MAX_TOKENS_V2`) + `wow-addon-import.schema.ts` (unchanged v1 limits and error codes) |
| JSON Schema of one decoded payload (generated) | [`schema.json`](./schema.json) — `npm run gen:ledgerlink-schema -w @raid-ledger/contract` |
| Golden fixtures | [`fixtures/`](./fixtures) — `cd api && npx ts-node scripts/gen-ledgerlink-fixtures.ts` (writes v1 unchanged + v2, each through the real decoder) |
| v1 (frozen) | [`../v1/CONTRACT.md`](../v1/CONTRACT.md) |

## 0. What changes from v1 (**breaking**)

1. Header version `!RL2!` **and** payload `schema: 2` on **every** section the
   addon emits.
2. New section `loot` (§3) — loot history.
3. **No `bank` section.** WoW: Forever runs a Classic-era client and a guild
   bank could not be verified (ruling Q1). A bank, if ever, is **v3**.
4. A mixed paste may carry one `loot` token; max tokens per paste 10 → 11.

Everything else — the encoding pipeline, the envelope fields, the `char` /
`guild` / `raid` `data` payloads, strict keys, guild paging, the mixed-paste
rules, the error codes — is **v1 unchanged**: read v1 CONTRACT §1–§8 for them.
Only the deltas are written here.

## 1. Encoding and header

Pipeline unchanged (v1 §1): JSON → zlib (RFC 1950) → standard base64 with
`=` padding.

```
^!RL(\d+)!(char|guild|raid|loot)(?:-(\d+)of(\d+))?!([A-Za-z0-9+/]+={0,2})$
     1 version  2 section            3 n     4 m      5 base64 body
```

- The header version must be one of `ADDON_EXPORT_ACCEPTED_VERSIONS` (`[1, 2]`)
  and the section must be in that version's set
  (`ADDON_EXPORT_SECTIONS_BY_VERSION`: v1 = char/guild/raid, v2 adds `loot`).
  `!RL1!loot!…` → `BAD_HEADER`; `!RL3!…` → `UNSUPPORTED_VERSION`.
- The payload `schema` must equal the header version. `!RL2!` around a
  `schema: 1` body → `UNSUPPORTED_VERSION` (the v1 fixture
  `invalid/unsupported-version` is exactly that string and keeps its code).
- Only `guild` pages (`ADDON_PAGED_SECTIONS`). `!RL2!loot-1of2!…` → `BAD_HEADER`.
- The addon emits **exactly one** version: once it switches to v2, every
  section it emits is `!RL2!` with `schema: 2`.

## 2. Envelope

v1 §2 unchanged except:

| Field | Type | Notes |
|---|---|---|
| `schema` | `2` | literal |
| `section` | `"char"` \| `"guild"` \| `"raid"` \| `"loot"` | must equal the header's section |

## 3. Section `loot` — `data`

Loot **history** only: who received which item, when, and from which boss if
known. No DKP, no points, no roll values, no chat text.

| Field | Type | Limits / notes |
|---|---|---|
| `windowStart` | int unix s | the oldest moment the addon still holds records for |
| `windowEnd` | int unix s | `≥ windowStart`; normally `exportedAt` |
| `minQuality` | int 0–7 | lowest item quality the addon recorded; an item below it is absent by design |
| `drops[]` | array ≤ **500** (`ADDON_LOOT_DROPS_MAX`) | oldest first; may be `[]` |

`windowStart` and `minQuality` tell the server what an **absent** drop means
(ruling Q9): not recorded, not lost.

Each `drops[]` entry (`.strict()`):

| Field | Type | Limits / notes |
|---|---|---|
| `at` | int unix s | `GetServerTime()` when the loot line arrived; `windowStart ≤ at ≤ windowEnd` |
| `itemId` | int ≥ 1 | parsed from `|Hitem:<id>:` |
| `link` | string ≤ 512, optional | raw `|Hitem:…|h[…]|h` as received; omit when not available |
| `quantity` | int 1–1000 | stack size received; `1` when the line has no multiplier |
| `quality` | int 0–7, optional | link colour / `GetItemInfo`; omit when unknown |
| `looterName` | string 1–100 | `Name-Realm` when the client gives a realm, else bare `Name` |
| `looterGuid` | string, optional | `^Player-\d{1,5}-[0-9A-F]{8}$`, from the group roster; **omit rather than guess** |
| `method` | `"master"` \| `"roll"` \| `"direct"` \| `"unknown"` | master loot assigned · won a need/greed roll · looted from the corpse / FFA / round-robin · could not tell |
| `instanceId` | int, optional | `GetInstanceInfo()` id (same id space as v1 `raid` `pulls[].instanceId`) |
| `difficultyId` | int, optional | `GetInstanceInfo()` difficulty id |
| `encounterId` | int, optional | the boss the drop is attributed to; omit for trash / unknown |
| `encounterName` | string ≤ 128, optional | `ENCOUNTER_END` name; **only together with `encounterId`** |

**Boss attribution (ruling Q4, addon-side):** tag a drop with the most recent
`ENCOUNTER_END` with `success = 1` **in the same instance** whose end is ≤ 300 s
(`ADDON_LOOT_ATTRIBUTION_WINDOW_SECONDS`) before `at`; otherwise omit
`encounterId` / `encounterName`. The server stores the attribution as sent.

**What to record (rulings Q9 / Q10):** only while the player is in a party or
raid **inside an instance** (no solo / open-world loot); every group member's
receipt that reaches the client as a loot line; items with quality ≥
`minQuality` (default 2 = uncommon, `ADDON_LOOT_DEFAULT_MIN_QUALITY`); a
rolling **30-day** window (`ADDON_LOOT_WINDOW_DAYS`), all of it sent on every
export.

**De-duplication (ruling Q5, server-side).** No client-side drop id exists and
every group member running LedgerLink records the same drops, so the server
de-duplicates on **(guild, `looterGuid ?? looterName`, `itemId`, `quantity`,
`floor(at / 120)`, `instanceId`)** (`ADDON_LOOT_DEDUP_BUCKET_SECONDS`). Two
identical items to the same looter inside one 2-minute bucket collapse into one
— accepted for history.

## 4. Mixed paste (v1 §5.1, deltas)

- At most **one** `loot` token per paste (`ADDON_IMPORT_MAX_LOOT_TOKENS`; a
  second → `PAGES_INCOMPLETE`).
- `ADDON_IMPORT_MAX_TOKENS_V2` = **11** (8 guild pages + char + raid + loot).
- Canonical order char → guild → raid → loot.
- Same-exporter and 600 s `exportedAt` rules apply to `loot` like any section.
- **One version per paste (ruling Q6):** `!RL1!` and `!RL2!` tokens in one
  paste → the whole paste is rejected with `UNSUPPORTED_VERSION` ("These
  strings come from different addon versions."). No new error code.
- All-or-nothing unchanged: a bad `loot` token rejects the whole paste.

## 5. Guild paging

v1 §5 unchanged.

## 6. Limits (deltas from v1 §6)

| Constant | Value | Over it |
|---|---|---|
| `ADDON_LOOT_DROPS_MAX` | 500 | `INVALID_PAYLOAD` |
| `ADDON_LOOT_LOOTER_NAME_MAX` · `ADDON_LOOT_ENCOUNTER_NAME_MAX` · `ADDON_LOOT_LINK_MAX` | 100 · 128 · 512 | `INVALID_PAYLOAD` |
| `ADDON_LOOT_QUANTITY_MAX` | 1000 | `INVALID_PAYLOAD` |
| `ADDON_IMPORT_MAX_TOKENS_V2` | 11 (v1: 10) | `PAGES_INCOMPLETE` |
| whole paste | 262 144 B server, **260 096 B** via the companion — unchanged | `TOO_LARGE` |
| per page inflated | 1 MiB — unchanged | `DECODED_TOO_LARGE` |
| clock | `exportedAt` +1 d / −365 d (unchanged); `drops[].at` +1 d future bound only (spec D9) | `INVALID_PAYLOAD` |

**Size budget (measured 2026-11-15, `zlib.deflateSync` default level).** A
realistic 500-drop token (repeating names, ids, no links) is ~111 KiB inflated
and **~7 KiB** on the wire. The theoretical worst case — 500 drops with every
string at its cap and filled with incompressible text — is ~480 KiB inflated
(under the 1 MiB page cap) but **~385 000 B** of base64, which alone exceeds
both the 262 144 B paste cap and the 260 096 B companion cap. Therefore:

> If an export would exceed 260 096 bytes, the addon drops the **oldest**
> `drops` until it fits and moves `windowStart` forward to the oldest drop it
> kept. It never cuts the char / guild / raid sections for loot.

## 7. Error codes

v1 §7 unchanged; v2 adds no code. Where each new case lands:

| Case | Code |
|---|---|
| `!RL1!loot!…`, `!RL2!loot-1of2!…` | `BAD_HEADER` |
| `!RL3!…`, `!RL2!` + `schema: 1`, a mixed `!RL1!`/`!RL2!` paste | `UNSUPPORTED_VERSION` |
| 501 drops, an unknown key, a drop outside the window, `encounterName` without `encounterId` | `INVALID_PAYLOAD` |
| two `loot` tokens in one paste | `PAGES_INCOMPLETE` |

An **old (v1-only) server** answers `UNSUPPORTED_VERSION` for
`!RL2!char/guild/raid` and `BAD_HEADER` for `!RL2!loot` — so the addon must
not emit `!RL2!` until Raid Ledger confirms a v2 server is deployed.

## 8. Fixtures

Same layout as v1 §8: a valid case is `<name>.txt` (the paste) + `<name>.json`
(the decoded view, `{ pages, payload }` or `{ sections: [...] }`); an invalid
case is `invalid/<name>.txt` + `invalid/<name>.json` (`{ code }`).

- **Every valid v1 fixture has a v2 twin of the same name** — each token
  re-encoded as `!RL2!`, the payload identical apart from `schema: 2`.
- New valid: `loot`, `loot-empty-window`, `mixed-char-guild3-raid-loot`.
- New invalid: `loot-too-many-drops`, `loot-unknown-key`,
  `loot-drop-outside-window`, `loot-encounter-name-without-id`, `loot-paged`,
  `loot-two-tokens`, `v1-loot-section`, `mixed-v1-v2`, `v2-header-schema-1`,
  `unsupported-version` (`!RL3!`).

**Anonymisation.** Fixtures are synthetic (the v1 builder's invented
identity). A real export string becomes a fixture only after: names →
invented, GUIDs → `Player-4395-…` / `Player-0000-…`, guild and realm names →
invented, account folder names never, timestamps shifted, free text dropped.
Item, encounter, instance and difficulty ids may stay. The contract spec
`ledgerlink-v2-contract.spec.ts` fails on a GUID from any other realm id.

LedgerLink pins a copy of `v2/` and validates its own output against
`schema.json` and round-trips `fixtures/` in its own CI. It never edits them.

## 9. Versioning

- **v1 is frozen** from ROK-2184 on: `v1/schema.json`, `v1/fixtures/` and the
  v1 Zod names (`AddonExportSchema`, `ADDON_IMPORT_PAGE_RE`, …) do not change;
  any further additive change goes into v2.
- **Transition (ruling Q7):** the server accepts `!RL1!` (`schema: 1`,
  char/guild/raid) **and** `!RL2!` (`schema: 2`, char/guild/raid/loot). v1 is
  dropped only after the operator confirms LedgerLink has shipped v2 **and**
  ≥ 90 days have passed **and** the import audit shows no accepted `!RL1!`
  import for 30 consecutive days — in its own small RL PR with a CHANGELOG
  entry; `v1/` stays on disk for reference.
- Additive within v2 follows v1 §9: a new **optional** key the server ignores
  stays v2 and ships server-first. A new section, a tightened limit or a
  renamed key is breaking → `v3/`.

## 10. Change process

Unchanged from v1 §10: only a Raid Ledger PR touching `ledgerlink/` changes the
format; it updates the Zod source, regenerates `schema.json` and the fixtures,
adds a `CHANGELOG.md` entry stating **additive** or **breaking**, and the
Raid Ledger Lead alerts the LedgerLink agent at PR open and again at merge.
LedgerLink requests a change through a Raid Ledger story.
