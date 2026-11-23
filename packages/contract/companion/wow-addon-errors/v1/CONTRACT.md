# Raid Ledger Companion `wow-addon-errors` wire contract — v1

**Owner: Raid Ledger.** Addon errors a WoW player's BugGrabber addon recorded,
read by the Companion from `WTF/Account/<folder>/SavedVariables/!BugGrabber.lua`,
parsed and **scrubbed on the PC**, and pushed as one envelope
(`contract: "wow-addon-errors"`, `contractVersion: 1`). Never the raw file. The
Companion collector pins a copy of this folder. Shared rules:
[`../../README.md`](../../README.md). Story: ROK-2099.

| What | Where |
|---|---|
| Message + payload Zod (source of truth) | `packages/contract/src/companion-wow-addon-errors.schema.ts` — `WowAddonErrorsMessageSchema`, `WowAddonErrorsPayloadSchema`, `WowAddonErrorRecordSchema` |
| JSON Schema of one message (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Conformance + drift guard | `packages/contract/src/__tests__/companion-wow-addon-errors-contract.spec.ts` (vitest) and `api/src/companion/companion-contract.spec.ts` (jest) |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Transport

Everything in the envelope contract ([`../../envelope/v1/CONTRACT.md`](../../envelope/v1/CONTRACT.md))
applies: `POST /companion/v1/messages/wow-addon-errors`, device bearer token,
gzip allowed, two-stage parse, ack and error codes, the 5-minute clock rule.
Registry entry: `maxBytes: 262_144` (`COMPANION_WOW_ADDON_ERRORS_MAX_BYTES` =
`COMPANION_MESSAGE_MAX_BYTES`), `blobSlots: []`, `status: 'current'`.

A body over the cap is refused `413 payload_too_large`; any schema failure
(strict key, refinement, limit) is `400 invalid_payload` with `issues`
(path + code only). No new error code.

## 2. Payload (`WowAddonErrorsPayloadSchema`, strict)

| Field | Type | Notes |
|---|---|---|
| `source` | `"buggrabber"` | The only source in v1 (operator ruling 1). A new value is additive. |
| `sourceVersion` | one-line text, 1–32 | BugGrabber's version from its `.toc`, e.g. `12.1.1`. |
| `accountKey` | lowercase hex SHA-256 (64) | SHA-256 of the `WTF/Account/<folder>` name. Never the raw name (README rule 6). |
| `characterHint?` | `{ name: 1–24, realm: 1–48 }` (one-line text, strict) | The uploader's **own** character + realm for this file when the collector can tell (ruling 6). Never another player. |
| `wowFlavor?` | `^[A-Za-z0-9_]{1,32}$` | The install flavour folder, e.g. `_classic_era_`. |
| `records` | `ErrorRecord[]`, 1–50 | Unique by (`addon`, `message`, `stack`) within one message. |

### 2.1 `ErrorRecord` (`WowAddonErrorRecordSchema`, strict)

| Field | Type | Notes |
|---|---|---|
| `addon` | one-line text, 1–64 | The addon the error points at (first `AddOns\<Name>\` segment), **not** BugGrabber. |
| `message` | multi-line text, 1–1024 | Scrubbed (§4). |
| `stack?` | multi-line text, 1–4096 | Scrubbed; the collector truncates with a `…[truncated]` marker. |
| `firstSeenAt` | `CompanionTimestamp` | Must be ≤ `lastSeenAt`. |
| `lastSeenAt` | `CompanionTimestamp` | |
| `count` | int 1–1 000 000 | BugGrabber `counter`. |
| `session?` | int 0–2 147 483 647 | BugGrabber session number. |

**There is no `locals` field** (ruling 7): BugGrabber's `locals` dump can hold
other players' names, so the collector never reads it and strict keys refuse
it (`record-locals`).

*One-line text* = no control characters, no line/paragraph separators, no
bidi controls, not whitespace-only, no lone surrogates (the shared
`companionDisplayTextSchema`). *Multi-line text* = tab, LF and CR allowed; NUL,
the other C0 controls and DEL refused; no lone surrogates.

## 3. Size

`records` ≤ 50, `message` ≤ 1024, `stack` ≤ 4096 UTF-16 units. A batch at
every maximum (50 × ~5.3 KB) can exceed the 262 144-byte body cap, so **the
collector splits a batch by size as well as by count**: if the compact JSON of
a 50-record message would pass the cap, send fewer records per message. The
server does not split; it answers `413`.

Measured fixture sizes (compact JSON bytes): `buggrabber-minimal` 489,
`buggrabber-three-addons` 1 487, `buggrabber-50-records` **22 271** (8.5 % of
the cap with realistic three-frame stacks).

## 4. Scrubbing (normative — the collector does it, the server repeats it)

1. **Paths.** The user's home folder (`<drive>:\Users\<name>\` on Windows, the
   `Users` home folder on macOS) becomes `<home>\`. Any absolute path up to and
   including `World of Warcraft\_<flavor>_\` becomes `<wow>\`.
   `Interface\AddOns\<Addon>\file.lua:NN` is kept — that is the useful part.
2. **WoW account folder name.** Never sent; `accountKey` is its SHA-256.
3. **Character and realm names.** Every occurrence of the account's own
   character and realm names (the collector knows them from the
   `WTF/Account/<folder>/<realm>/<character>/` folders) and the BattleTag in
   `message`/`stack` becomes `<char>` / `<realm>`. The uploader's own character
   is sent once, separately, as `characterHint`.
4. **No raw SavedVariables** (ruling 5) and **no `locals`** (ruling 7).

**The schema refuses an unscrubbed path** (ruling 7) in `addon`, `message`,
`stack` and `sourceVersion`, so a scrub bug fails loud in the Companion's own
CI. Refused: a drive letter + colon + slash or backslash that does not follow a
letter or digit (so `https://` passes), and a `Users` folder segment between
separators (any slash direction, any case). The pattern is
`WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE`, published in `schema.json` as
`not.pattern` (no lookaround, so Rust's `regex` crate compiles it). The issue
is `invalid_format` at the field. The scrubbed forms `<home>\` and `<wow>\`
never match.

## 5. Strict keys and refinements

Every object is **strict**. Refinements the Zod schema enforces but
`schema.json` cannot express: `firstSeenAt ≤ lastSeenAt` (`custom` at
`…firstSeenAt`), record uniqueness (`custom` at the duplicate's index), no
lone surrogates. The path refusal **is** expressed (`not.pattern`).

## 6. Fixtures

Built by a throwaway script from synthetic data — never from a real file:

- Account key = SHA-256 of the placeholder `EXAMPLEACCOUNT`; character
  `Testchar` on realm `Example Realm`; addon names are public addon folder
  names (`Mailworthy`, `Questie`, `BuffRadar`, `OpenMap`) or `TestAddonNN`;
  messages and stacks are invented, already in scrubbed form; timestamps and
  versions are synthetic. No real names, GUIDs, guild names, account folder
  names or paths.
- `fixtures/<case>.json`: `buggrabber-minimal` (one record, no optional
  fields), `buggrabber-three-addons` (every optional field),
  `buggrabber-50-records` (the record cap).
- `fixtures/invalid/<case>.json` + `EXPECTED.json` (the Zod issue
  `{ path, code }` each must raise): `envelope-unknown-key`,
  `payload-unknown-key`, `record-locals`, `contract-version-2`,
  `source-mailworthy`, `account-key-raw`, `records-empty`, `records-51`,
  `message-over-cap`, `stack-over-cap`, `count-zero`, `first-after-last`,
  `duplicate-record`, `message-nul-byte`, `stack-drive-path` (a forward-slash
  drive path), `message-users-folder` (a backslash `Users` segment).
- A backslash drive path (the canonical Windows home folder) is **not** a
  fixture file: the repo-wide anonymisation guard
  (`api/src/companion/companion-contract.spec.ts` C5) forbids that literal in
  any file under `companion/`. The vitest spec builds those cases in code.

## 7. Versioning and change process

Same rules as the shared README §3. A new `source` value (for example
Mailworthy `[error]` lines) or a new optional record field is **additive**;
lowering a cap or tightening the path pattern is **breaking**. Only a Raid
Ledger PR touching this folder changes the format; it regenerates
`schema.json`, adds a `CHANGELOG.md` entry and says **additive** or
**breaking** in its body.
