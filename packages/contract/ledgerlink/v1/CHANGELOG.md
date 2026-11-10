# LedgerLink wire contract — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v1 — 2026-11-09 — new reject code `CHARACTER_MOVED` — **additive**

- `AddonImportErrorCodeSchema` gains `CHARACTER_MOVED` (ROK-2159; stays v1):
  an apply whose Raid Ledger character changed owner (admin Change owner)
  while the import ran is rejected with **HTTP 409** and nothing is written.
  An apply-time check, not an addon-format bug — the string is unchanged.
- No payload, fixture or `schema.json` change. Through the companion bridge
  it surfaces as `invalid_payload` like every other apply-time code.

## v1 — 2026-11-09 — `char` `addons` installed-addon list — **additive**

- The `char` section's `data` gains one **optional** key, `addons`
  (ROK-2147; stays v1): every addon folder installed in the exporter's
  client — `addons[] ≤ 500 { name (1–64, the folder name), title? ≤ 128
  (`## Title`), version? ≤ 32 (`## Version`), loaded: boolean }`, loaded
  entries first. Every entry is `.strict()`. The addon cuts the list and the
  strings to the caps before export; the server rejects anything over a cap.
- Semantics: an **absent** `addons` = no opinion (the server keeps the list
  it stored); `[]` = nothing installed. Duplicate `name`s (case-insensitive)
  are not a reject — the server keeps the first. Colour codes in `title` are
  stripped by the server sanitizer.
- The decoded fixture view carries the list as `payload.addons`, beside the
  frozen snapshot `payload.data` (it is never stored in the char snapshot).
- New golden fixture `char-installed-addons`; invalid fixtures
  `invalid/char-addons-too-many` (501 entries) and
  `invalid/char-addons-name-too-long` (65-char `name`). Every existing
  fixture unchanged byte-for-byte. `schema.json` regenerated. Worst case
  (max `quests` + max `mailworthy` + 500 max-length entries) = 133 134 B,
  under the 260 096 Companion cap.
- **An older server rejects a char export carrying `addons` with 422
  `INVALID_PAYLOAD`.** LedgerLink must not emit it until a server carrying
  this change is deployed.

## v1 — 2026-11-09 — `char` `mailworthy` guild contributions block — **additive**

- The `char` section's `data` gains one **optional** key, `mailworthy`
  (ROK-2148; stays v1): what the Mailworthy addon knows about the exporter's
  guild — `generatedAt`, the guild template `{ rev, author, rules[] ≤ 8 of
  { professionSkillLineId, recipientName } }` (per-unit caps are never sent),
  `peers[] ≤ 1000 { name, lastSeenAt }` (guild members whose Mailworthy said
  hello in the last 60 days) and `givers[] ≤ 200 { characterName,
  itemsAllTime, countingSince, asOf, days[] ≤ 35 { day, items } }` —
  guild-rule item units sent per character, per UTC day, for the
  exporter's account AND guildmates whose totals Mailworthy shared in the
  guild hellos (operator ruling 2026-11-08). `asOf` (required, unix
  seconds, `≤ generatedAt`) = when the giver's own client computed them.
  `template.rules` may be `[]` (template published with no rules). Every
  object is `.strict()`; names ≤ 48.
- Semantics: an absent block, template, `peers` or `givers` = no opinion;
  nothing stored is cleared. Account-wide data exported by several alts is
  deduped server-side (template by `rev`, peers by name, givers by guild +
  sending character, newest `asOf`, tie → newer `generatedAt`). Item counts are stack units of guild-rule mail
  only; mail to one of the sender's own characters never counts.
- The decoded fixture view carries the block as `payload.mailworthy`, beside
  the frozen snapshot `payload.data` (it is guild-level data, never stored in
  the char snapshot).
- New golden fixtures `char-mailworthy`, `char-mailworthy-template-only`;
  invalid fixtures `invalid/char-mailworthy-rule-cap`,
  `invalid/char-mailworthy-too-many-rules`. Every existing fixture
  unchanged byte-for-byte. `schema.json` regenerated.
- A server without this change rejects a char export carrying `mailworthy`
  with 422 `INVALID_PAYLOAD`. LedgerLink must not emit it until a server
  carrying this change is deployed.

## v1 — 2026-11-08 — `char` `quests.completed` optional — **additive**

- `data.quests.completed` becomes optional (ROK-2125, operator ruling
  2026-11-07); stays v1. `quests` keeps `.strict()`; `inProgress` stays
  required; the 10 000-id cap and `completedTruncated` are unchanged.
  `schema.json` regenerated (`completed` dropped from the `quests` `required`
  list only).
- Semantics: **absent** = no opinion — the server takes the completed list
  (with its truncation flag and date) from the Forever Armory
  `quests/completed` sync, and an import that omits it keeps the completed
  list already stored for the character. **Empty** (`[]`) keeps its meaning:
  the character has completed no quests.
- New golden fixture `char-forever-quests-log-only` (the quest log, no
  `completed` key). Every existing fixture unchanged byte-for-byte.
- A server without this change rejects a `quests` without `completed` with
  422 `INVALID_PAYLOAD`. The addon must keep sending `completed` until a
  server carrying this change is deployed.

## v1 — 2026-11-08 — guild in-game MOTD + Guild Information — **additive**

- The `guild` section's `data` gains two **optional** keys (ROK-2137, guild
  text sync P1; stays v1): `motd` (≤ 255) — the in-game Message of the Day —
  and `infoText` (≤ 499) — the in-game Guild Information, both verbatim
  (colour codes and newlines kept). `""` reports an empty box; an absent key
  means "no opinion" and never clears what the server stored. Both are
  guild-visible text; officer notes are still never read or sent.
- `schema.json` regenerated (two optional string properties). New golden
  fixture `guild-ingame-text` (one page, three anonymised members, both keys
  set). Every existing fixture unchanged byte-for-byte.
- The server stores the last reported text per guild (control characters the
  hub's save rejects stripped) stamped with min(`snapshotAt`, server receive
  time), plus the exporter's `who.fullName`. A field moves only when its text
  CHANGED and the snapshot is not older than the stored one, so re-exporting
  the same text keeps the stamp; an older snapshot never overwrites a newer
  report, and an export the roster-replace guard flags stores no text. A server
  without this change rejects either key with 422 `INVALID_PAYLOAD` (strict
  keys), so the addon must not send them until a server carrying this change
  is deployed.

## v1 — 2026-11-06 — rppvp ruleset — **additive**

- `who.ruleset` gains `rppvp` (RP-PvP realms, ROK-2101); stays v1. Every
  other field is unchanged. `schema.json` regenerated (one enum value added);
  new golden fixture `char-rppvp` (identical to `char-roleplaying` except
  `who.ruleset`). Every existing fixture unchanged byte-for-byte.
- A server without this change rejects the unknown enum value with 422
  `INVALID_PAYLOAD`. The addon must not send `rppvp` until a server carrying
  this change is deployed.

## v1 — 2026-11-02 — a newer guild snapshot from any roster member applies — **additive** (server acceptance rule)

- **Wire format unchanged; stays v1** — no `schema.json` or fixture change
  (operator ruling 2026-11-02, ROK-2066). Once a guild exists, a non-staff
  importer no longer needs an admin-made editor grant: a guild section whose
  exporter is in the roster and whose `data.snapshotAt` is not older than the
  stored one replaces the roster. A wholesale change (≥ 5 and > 25% of the
  roster added or removed within 24 h) is no longer refused with
  `INVALID_PAYLOAD`; it applies and Raid Ledger staff get a notice. So an
  "Export all" (LedgerLink's logout auto-export) from a plain member no
  longer loses its `char` section to a guild reject. `NOT_IN_GUILD` now means
  only "the exporter is not in the roster". See `CONTRACT.md` §5.1.

## v1 — 2026-10-10 — Export clock window — **additive** (server acceptance rule)

- **Wire format unchanged; stays v1** (operator ruling 2026-10-10, ROK-1756).
  The server now rejects, with 422 `INVALID_PAYLOAD`, any export whose
  `exportedAt` (or guild `data.snapshotAt`) is more than **1 day ahead of** or
  more than **365 days behind** the server clock. Raid `pulls[]` timestamps get
  only the 1-day future bound. LedgerLink stamps the current time, so only a
  year-old re-paste or a badly wrong client clock is affected. The
  user-facing message asks the user to check the computer's date and export
  again. See `CONTRACT.md` §6.
- Golden fixtures are unchanged. The conformance specs pin the server clock
  (`testing/pin-export-clock.ts`), so the 2026-09-21 fixtures never age out.

## v1 — 2026-10-10 — decoded gear name/quality from the raw link — **additive**

- **Additive (stays v1). Wire format unchanged** — no `schema.json` change,
  nothing new for the addon to emit (ROK-1760). Raid Ledger now reads the
  item name (`|h[...]|h`, ≤ 128) and quality (`IQ<n>`, 0–7) out of the
  existing raw gear `link` and keeps them as optional `name` / `quality` on
  each decoded gear item, so a slot reads "Recruit's Shirt" before the
  Wowhead resolver fills it in. The `char-*` and `mixed-char-*` golden
  fixture `.json` files were regenerated (`api/scripts/gen-ledgerlink-fixtures.ts`)
  to include the decoded `name`; the `.txt` pastes are unchanged.

## v1 — 2026-10-10 — golden fixture correction — **no format change**

- **Fixture only (stays v1).** `fixtures/char-forever-talents-named` (`.txt` +
  `.json`) regenerated so every node's `tree`/`row`/`col` hint equals the
  CONTRACT.md §3 rule applied to its own `posX`/`posY` (ROK-1758). No schema,
  `schema.json` or Zod change; addon copies should re-sync the fixture pair.

## v1 — 2026-10-09 — Forever character fields — **additive**

- **Additive (stays v1).** New optional keys in the `char` section (ROK-1742):
  `who.gender` (`"male"` | `"female"`; omit when `UnitSex` is unknown);
  `talents.nodes[]` gains `name?` (≤ 64), `spellId?`, `maxRanks?` (1–255),
  `tree?` (0–2), `row?` (0–9), `col?` (0–3) and the raw `posX?` / `posY?`;
  `data.quests?` = `{ completed: questId[] ≤ 10 000, inProgress: [{ questId,
  title? ≤ 128, objectives? ≤ 10: [{ text ≤ 128, done, have?, need? }] }] ≤ 35 }`.
  Every new object is `.strict()`; an export without the new keys decodes
  exactly as before.
- **Server ships first.** The addon may emit these keys only after
  re-syncing this `schema.json` (and the fixtures) into its pinned copy;
  until then an older server rejects them as unknown keys.
- New constants `ADDON_QUESTS_COMPLETED_MAX = 10 000`,
  `ADDON_QUESTS_IN_PROGRESS_MAX = 35`, `ADDON_QUEST_OBJECTIVES_MAX = 10`.
  `quests.completed` is the one array allowed past the 2000 structural cap.
- Talent position rule: CONTRACT.md §3. Raw `posX` / `posY` are
  authoritative; `tree` / `row` / `col` are the addon's derived hint, by the
  published rule (cluster `posX` by ~2200 gaps → sub-tree; `col` / `row` =
  rounded 600-unit steps from the cluster min / `posY` 2130), confirmed on
  Warrior, Druid and Paladin (beta build 70291).
- Fixtures: new valid `char-forever-quests` (`completed` at the 10 000 cap,
  enchanted + socketed gear links), `char-forever-talents-named`; new
  invalid `gender-unknown-value`, `quests-completed-over-cap` (10 001 ids).
  Every existing fixture unchanged byte-for-byte. Server-side only: the
  stored snapshot (schema 2) also keeps `enchantId` / `gemIds` parsed from
  the gear link; the wire format is unaffected.
- `quests.completedTruncated?: boolean` (absent = `false`): set by the addon
  when `completed` was cut to `ADDON_QUESTS_COMPLETED_MAX` ids (first ids
  ascending); kept in the stored snapshot. New valid fixture
  `char-forever-quests-truncated` (3 ids + `completedTruncated: true`).

## v1 — 2026-10-07 — two apply-time error codes — **additive**

- **Additive (stays v1).** `AddonImportErrorCodeSchema` gains
  `CHARACTER_CLAIMED` and `RULESET_REQUIRED` (both 422), returned only by the
  new Raid Ledger "create a character from an export" route (ROK-1738).
  Like the other apply-time codes (CONTRACT.md §7) they are checks against
  the Raid Ledger account, never addon-format bugs. Token grammar, envelope,
  payloads, fixtures and `schema.json` unchanged.

## v1 — 2026-10-05 — mixed paste ("Export all") — **additive**

- **Additive (stays v1).** One paste may now carry one `char`, one `guild`
  export (unpaged or every page once) and one `raid` string together, any
  order (ROK-1737, CONTRACT.md §5.1). Token grammar, envelope and every
  payload unchanged; a single-section paste decodes exactly as before
  (same result, same per-section sha256). The addon may adopt it at will.
- New constants: `ADDON_IMPORT_MAX_TOKENS = 10` (whole paste),
  `ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS = 600`. `ADDON_IMPORT_MAX_PAGES`
  stays 8 and now applies to one guild export's pages only.
- Mixed paste is all-or-nothing; every section must share `who.guid`,
  `client.region`, the realm-less exporter name, and an `exportedAt` within
  600 s (`INVALID_PAYLOAD`); a duplicate section → `PAGES_INCOMPLETE`. The
  character binding runs against every section. Still additive: these rules
  only reject pastes that were rejected entirely before ROK-1737.
- Fixtures: valid `.json` for a mixed paste is `{ sections: [...] }`
  (CONTRACT.md §8). New valid: `mixed-char-raid`,
  `mixed-char-guild3-raid-shuffled`; new invalid: `mixed-two-char`,
  `mixed-guild-incomplete`, `mixed-different-exporters`,
  `mixed-different-region`, `mixed-11-tokens`.
  Every existing fixture unchanged byte-for-byte. `schema.json` unchanged.

## v1 — 2026-10-05 (initial)

- **Breaking (new contract).** First formal, versioned contract between Raid
  Ledger and the LedgerLink addon (ROK-1724; operator ruling 2026-10-05:
  Raid Ledger owns the format, LedgerLink conforms).
- Envelope `!RL1!<section>[-<n>of<m>]!<base64(zlib(json))>`, sections
  `char` / `guild` / `raid`; guild paging up to 8 pages / 2000 members.
- Payload `schema: 1`; every object strict (unknown key rejects the string;
  no `officerNote`); `client.region` numeric 1–5; ruleset spelled
  `roleplaying`.
- `schema.json` generated from `AddonExportSchema`; golden fixtures: 7 valid,
  9 invalid.

- 2026-10-05 v1 — fixture fix, additive: guild fixtures now include the exporter; wire format unchanged.

- 2026-10-22 v1 — **Additive (stays v1).** Wire format unchanged. Metadata only: `$id` moved off a private instance to the public repo path (ROK-1897).
