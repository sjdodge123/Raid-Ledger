# LedgerLink ↔ Raid Ledger wire contract — v1

**Owner: Raid Ledger.** LedgerLink (github.com/sjdodge123/ledger-link)
conforms to this document. Neither side changes the format unilaterally —
see [Change process](#change-process).

| What | Where |
|---|---|
| Payload source of truth (Zod) | [`packages/contract/src/wow-addon-export.schema.ts`](../../src/wow-addon-export.schema.ts) — `AddonExportSchema` |
| Limits, page header regex, error codes (Zod) | [`packages/contract/src/wow-addon-import.schema.ts`](../../src/wow-addon-import.schema.ts) |
| JSON Schema of the decoded payload (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Server decoder | `api/src/plugins/wow-common/addon-import/addon-import.decoder.ts` |
| Conformance + drift guard (api jest, runs in CI) | `api/src/plugins/wow-common/addon-import/ledgerlink-contract.spec.ts` |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Encoding pipeline

```
payload (JSON object, UTF-8)
  → zlib  (RFC 1950: 2-byte header + DEFLATE + Adler-32 trailer)
  → base64 (RFC 4648 §4 STANDARD alphabet A–Z a–z 0–9 + /, WITH '=' padding)
  → "!RL1!" + section [ + "-<n>of<m>" ] + "!" + base64
```

One export string = one **page token**. Header grammar
(`ADDON_IMPORT_PAGE_RE`):

```
^!RL(\d+)!(char|guild|raid)(?:-(\d+)of(\d+))?!([A-Za-z0-9+/]+={0,2})$
     1 version  2 section       3 n     4 m      5 base64 body
```

What the decoder **tolerates**:

- leading/trailing whitespace around the whole paste (trimmed);
- several tokens separated by any whitespace (newline, space), in **any
  order** — the pages of one guild export, and/or one `char`, one `guild`
  export and one `raid` string together (a mixed paste, §5.1).

What it does **not** tolerate (the addon must normalise before emitting):

| Input | Result |
|---|---|
| URL-safe alphabet (`-` `_`) | `BAD_HEADER` (fixture `invalid/url-safe-base64`) |
| Missing `=` padding (body length not a multiple of 4) | `CUT_OFF` (fixture `invalid/unpadded-base64`) |
| Whitespace / line wrap **inside** a token | splits it into tokens → `BAD_HEADER` |
| Raw DEFLATE without the zlib header, or a corrupted trailer | `CUT_OFF` |

## 2. Envelope (every section)

All numbers are JSON numbers (never strings); every "int" is an integer
`0 … 2147483647` unless stated. Omit an optional field rather than sending
`null`; `null` is legal only where listed.

| Field | Type | Notes |
|---|---|---|
| `schema` | `1` | literal; payload schema number |
| `addonVersion` | string ≤ 32 | free-form addon version |
| `client.interface` | int | `select(4, GetBuildInfo())` |
| `client.build` | string ≤ 32 | |
| `client.locale` | string ≤ 8 | e.g. `enUS` |
| `client.region` | int **1–5** | `GetCurrentRegion()`: 1 us · 2 kr · 3 eu · 4 tw · 5 cn. **Numeric** — `"us"` is `INVALID_PAYLOAD` |
| `exportedAt` | int unix **seconds** | `1 … 4102444800`; a milliseconds value is rejected |
| `who.guid` | string | `^Player-\d{1,5}-[0-9A-F]{8}$` |
| `who.fullName` | string ≤ 100 | |
| `who.raw` | object | raw identity calls as returned: `getUnitName?` string, `unitName?` / `unitFullName?` `[string\|null, (string\|null)?]` (Lua drops a trailing nil), `realmName?` string |
| `who.ruleset` | `"normal"` \| `"pvp"` \| `"roleplaying"` \| `"hardcore"` \| `null` | spelled **`roleplaying`** (not `rp`/`roleplay`); `null` when the addon can't tell |
| `who.class` | string | client class token `^[A-Z]{2,16}$`, e.g. `PALADIN` |
| `who.race` | string ≤ 32 | |
| `who.level` | int 1–100 | |
| `who.faction` | `"Alliance"` \| `"Horde"` \| `"Neutral"` | |
| `who.guildName` | string ≤ 64, optional | omit when guildless |
| `section` | `"char"` \| `"guild"` \| `"raid"` | must equal the header's section |
| `data` | object | per section, below |

## 3. Sections

**`char`** — `data`:
- `gear[]` ≤ 19: `{ slot 1–19, itemId?, link? (≤ 512, raw `|Hitem:…|h`), ilvl? }`
- `talents`: `{ configId?, importString? (≤ 2048), nodes[] ≤ 200: { nodeId, rank, entryId? } }`
- `lockouts[]` ≤ 100: `{ name ≤ 128, instanceId, difficultyId, resetAt (unix s), killed, total }`

**`guild`** — `data`:
- `name` 1–64, `rawRealm?` ≤ 64, `snapshotAt` (unix s)
- `canViewOfficerNote`: must be the literal **`false`**
- `members[]` ≤ 2000: `{ guid, name ≤ 100, rankIndex 0–255, rank ≤ 64, level 1–100, class, online: boolean, lastOnlineDays?, note? ≤ 256 (public note, only when the player opted in) }`

**`raid`** — `data`:
- `pulls[]` ≤ 200: `{ encounterId, name ≤ 128, difficultyId, groupSize 1–40, instanceId?, startAt, endAt (unix s), success: boolean, roster[] ≤ 40 GUIDs, rosterNames[] ≤ 40 }`

## 4. Strict keys (non-negotiable)

Every object in the payload is `.strict()`. **One unknown key anywhere
rejects the whole string** with `INVALID_PAYLOAD` — nothing is partially
imported. Above all the addon must **never emit `officerNote`** (operator
ruling 2026-10-04, Q4); fixture `invalid/unknown-key-officer-note` pins it.

## 5. Guild paging

- Only `guild` may be paged. A roster that fits one page uses the
  **unpaged** header `!RL1!guild!…` (fixture `guild-1-page`).
- Paged header: `!RL1!guild-<n>of<m>!…`, `1 ≤ n ≤ m ≤ 8`. Paste = every page
  `1..m` exactly once, any order (fixtures `guild-3-pages`,
  `guild-8-pages-2000-members`).
- Every page is a complete payload with the **same** `who.guid`,
  `exportedAt`, `data.name` and `data.snapshotAt`; only `data.members`
  differs. Mismatch → `PAGES_INCOMPLETE`.
- A member GUID may appear on only one page (`INVALID_PAYLOAD`); the merged
  roster must stay ≤ 2000.
- LedgerLink emits 250 members per page (2000 / 250 = 8). The server does not
  enforce a per-page count below the 2000 schema cap.

### 5.1 Mixed paste — "Export all" (additive, ROK-1737)

One paste may carry the `char`, `guild` and `raid` strings together, so
LedgerLink can offer a single "Export all" box. The token grammar and every
payload are unchanged — this only widens what one paste may contain.

- Every token's header is parsed first and the tokens are grouped by
  section; any order, any whitespace between them.
- `char`: at most **one** token. `raid`: at most **one** token. `guild`:
  exactly one export, under the §5 page-set rules unchanged (one unpaged
  token, or every page `1..m` once). A second char/raid string or a second
  guild export → `PAGES_INCOMPLETE` (fixture `invalid/mixed-two-char`); a
  guild page missing → `PAGES_INCOMPLETE` (`invalid/mixed-guild-incomplete`).
- At most `ADDON_IMPORT_MAX_TOKENS` (10 = 8 guild pages + 1 char + 1 raid)
  tokens → else `PAGES_INCOMPLETE` (`invalid/mixed-11-tokens`).
- **Same exporter:** every section must carry the same `who.guid`, the
  same `client.region` and the same exporter name (the realm-less name the
  binding resolves from `who`, compared case-insensitively) → else
  `INVALID_PAYLOAD` "These strings come from different characters."
  (`invalid/mixed-different-exporters`, `invalid/mixed-different-region`);
  and the sections' `exportedAt` may differ by at most
  `ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS` (600 s) → else
  `INVALID_PAYLOAD`. "Export all"
  stamps every section within a second; 10 minutes still admits sections
  exported one by one in the same sitting, and rejects a stale string from an
  earlier session pasted beside fresh ones.
- **All-or-nothing:** each section is decoded and validated exactly as if it
  were pasted alone; if any section fails, the whole paste is rejected and
  the error `message` is prefixed with the section (`Raid export: …`).
  Nothing is partially imported. The character binding (game, region,
  name, ruleset, GUID) runs against **every** section, not just the first;
  any section's binding reject rejects the whole paste.
- **One authoritative section for the character row:** the class/level
  update, the ruleset change (`confirm.updateRuleset`) and the GUID pin
  follow ONE section — the `char` section when present (it is the
  character snapshot), otherwise the section with the newest `exportedAt`
  (ties → canonical order). Binding warnings come from that section too;
  rejects still come from every section.
- Each section keeps its own identity: its sha256 (re-pasting one section
  alone is recognised as the same import) and page count.
- A mixed paste changes **no per-section rule** — e.g. `client.region` is
  validated per section exactly as in §2 (the beta client's region value is
  ROK-1736's concern, not this one).
- The addon should still emit single-section strings for single-section
  exports; mixing is optional, never required.

## 6. Limits (exported constants)

| Constant | Value | Applies to | Over it |
|---|---|---|---|
| `ADDON_IMPORT_MAX_BYTES` | 262 144 | whole trimmed paste (all pages + separators), UTF-8 bytes | `TOO_LARGE` (HTTP 413) |
| `ADDON_IMPORT_MAX_PAGES` | 8 | pages of **one** guild export (`m ≤ 8`) | `BAD_HEADER` (`m` > 8) / `PAGES_INCOMPLETE` |
| `ADDON_IMPORT_MAX_TOKENS` | 10 | whitespace-separated tokens in the whole paste (8 guild pages + char + raid) | `PAGES_INCOMPLETE` |
| `ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS` | 600 | `exportedAt` spread across the sections of a mixed paste | `INVALID_PAYLOAD` |
| `ADDON_IMPORT_MAX_DECODED_BYTES` | 1 048 576 | inflated JSON, **per page** | `DECODED_TOO_LARGE` |
| guild `members` | 2000 | per page and merged | `INVALID_PAYLOAD` |
| structural (server-internal, `addon-import.limits.ts`) | depth ≤ 12, arrays ≤ 2000, any string or key ≤ 2048 UTF-8 bytes | decoded JSON | `INVALID_PAYLOAD` |

## 7. Error codes (`AddonImportErrorCodeSchema`)

Body: `{ code, message }` — `message` never echoes the paste. HTTP 413 for
`TOO_LARGE`, 429 for `RATE_LIMITED`, 422 otherwise.

| Code | Meaning for the addon author |
|---|---|
| `TOO_LARGE` | Paste over 256 KiB — fewer members / pulls per export. |
| `BAD_HEADER` | Token doesn't match the header grammar (wrong prefix, URL-safe base64, paged non-guild, impossible `n`/`m`). |
| `UNSUPPORTED_VERSION` | `!RL<n>!` is not a version the server accepts (message says which side to update). |
| `CUT_OFF` | Base64 length not a multiple of 4, zlib stream invalid/truncated, or inflated bytes aren't JSON. |
| `DECODED_TOO_LARGE` | A page inflates past 1 MiB. |
| `INVALID_PAYLOAD` | JSON violates the schema (unknown key, wrong type, out of range, header/section mismatch, duplicate member, structural limit), or the sections of a mixed paste come from different characters / exports. Message names the field **path** only (prefixed with the section in a mixed paste). |
| `PAGES_INCOMPLETE` | > 10 tokens, a guild page missing/duplicated, mixed `m`, pages from different exports, a second char/raid string or a second guild export in one paste. |
| `WRONG_GAME` · `REGION_MISMATCH` · `NAME_MISMATCH` · `NOT_IN_GUILD` · `GUID_CONFIRM_REQUIRED` · `RATE_LIMITED` | Apply-time checks against the Raid Ledger character/account — the string itself is well-formed. Not addon-format bugs. |

## 8. Fixtures

`fixtures/<name>.txt` is the paste exactly as a user would paste it;
`fixtures/<name>.json` is the paste **as the server decodes it**, in one of
two shapes — tell them apart by the presence of `sections`:

| Paste | `.json` shape |
|---|---|
| one section (`char-*`, `guild-*`, `raid`) | `{ "pages": <n>, "payload": <decoded payload> }` |
| mixed (`mixed-*`, §5.1) | `{ "sections": [ { "section": "char"\|"guild"\|"raid", "pages": <n>, "payload": <decoded payload> }, … ] }` — sections in canonical order **char → guild → raid**, whatever the paste order; absent sections are omitted |
| invalid (`invalid/*`) | `{ "code": <AddonImportErrorCode> }` |

Each decoded payload is
display strings have WoW UI escapes (`|cAARRGGBB…|r`, `|H…|h`, …) stripped,
and char gear `link` is replaced by the parsed `itemId` + `bonusIds`. So a
`.json` is the decoded view, not the raw addon emit. `fixtures/invalid/<name>.txt`
must fail with the `code` in its `.json`. The generator and the conformance
spec share one shape function
(`api/src/plugins/wow-common/addon-import/testing/ledgerlink-fixture-view.ts`). All data is synthetic (fixture
builder) — no real players.

Regenerate (Raid Ledger side only):

```
cd api && npx ts-node scripts/gen-ledgerlink-fixtures.ts
npm run gen:ledgerlink-schema -w @raid-ledger/contract
```

LedgerLink should run its encoder against these fixtures (decode its own
output with the same pipeline and compare), and must not keep an edited copy.

## 9. Versioning

- The contract version is the envelope version `!RL<n>!`
  (`ADDON_EXPORT_ENVELOPE_VERSION`). The addon emits **exactly one** version.
- **Stays v1 (additive):** a new **optional** field the server can ignore.
  Because every object is strict, the **server ships first** — the field is
  added to the Zod schema and released — and only then may the addon emit it.
  An addon that emits a field the deployed server doesn't know yet is
  rejected.
- **Requires v2 (breaking):** renaming or removing a field, making an
  optional field required, changing a type, range or enum spelling, or
  changing the encoding (compression, alphabet, header grammar, paging).
  v2 lives in a new `ledgerlink/v2/` folder with its own schema, fixtures and
  changelog entry; `v1/` is frozen from then on.
- **Transition:** during a version change the server accepts the current
  **and** the previous version; the previous one is dropped only after the
  operator confirms LedgerLink has shipped the new one. (Today the decoder
  accepts exactly `1`.)

## 10. Change process

1. Only a **Raid Ledger PR touching `packages/contract/ledgerlink/`** may
   change the format. It updates the Zod source, regenerates `schema.json`
   and the fixtures, adds a `CHANGELOG.md` entry, and states in the PR body
   **additive** or **breaking** (with the version bump for breaking).
2. The api jest spec `ledgerlink-contract.spec.ts` fails CI if `schema.json`
   drifts from the Zod source or a fixture stops decoding to its `.json`.
3. LedgerLink requests a change by filing a Raid Ledger issue/story — never by
   editing its own copy of the format. Agents on either side do not change
   the format on their own.
