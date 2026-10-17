---
story: ROK-1718 — spike(wow): realmless ruleset + two-part-name character identity for WoW: Forever
type: spike (decision doc) — gates ROK-1721 (manual entry, due 2026-10-30) and ROK-1722 (Armory import, later)
base: origin/main @ 3c544b6c1 (2026-10-04)
tier of the follow-on build (ROK-1721): standard — migration + contract + 3 web forms. Gate: `validate-ci.sh --full` (migration + contract in diff), fleet test plan (both colour families, phone + desktop).
design reference: none exists for the Forever form (searched: Linear ROK-1718/1721/1722 bodies, research doc). Wireframes in section 6 are a PROPOSAL for operator ruling, not an approved target.
design system: docs/design-system.md 3.1 (`Field`, `Input`, `Select`, `RadioGroup`), 4.11 Forms. No new pattern proposed.
dependencies: ROK-1716 (namespace probe), ROK-1717 (runtime prefix + armory capability flag) — only for ROK-1722.
---

> **Source:** `planning-artifacts/specs/ROK-1718.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-04
> **Linear:** ROK-1718 (approved target, including the operator rulings at the end)

# ROK-1718 — Forever character identity

## Provenance

| Input | Where |
|---|---|
| Issue bodies ROK-1718 / ROK-1721 / ROK-1722 | read from Linear (read-only) 2026-10-04 |
| Facts + sources | `docs/spikes/wow-forever-api-research.md` (research lane, same day) |
| Code | `git show origin/main:<path>` @ 3c544b6c1; every anchor below was grepped/sed'd on that commit |
| Operator ruling 2026-10-04 | brief + ROK-1721: manual entry at launch (ruleset, two-part name, class, role); Armory import later behind a flag |

AC2 of ROK-1718 ("map how the probe's realm/ruleset index and a real Profile URL encode a two-part name") is **NOT reachable** before launch + ROK-1716 going green. This doc designs so that answer can be slotted in without a second migration (section 3, "Armory match").

## 1. Facts (with sources)

| # | Fact | Source | Confidence |
|---|---|---|---|
| F1 | Launch 2026-11-04 (15:00 PT); early name reservation 2026-10-27 → 11-03 | https://us.shop.battle.net/en-us/product/world-of-warcraft-forever ; https://news.blizzard.com/en-us/article/24304161/create-a-name-of-your-own-in-wow-forever | official |
| F2 | Realmless. Player picks a **ruleset**: Normal, PvP, Roleplaying, Hardcore (Hardcore "sometime after launch"). Each ruleset is "a broad player ecosystem rather than a single traditional realm". | https://news.blizzard.com/en-us/article/24302070/choose-your-ruleset-in-world-of-warcraft-forever | official |
| F3 | No cross-ruleset dungeon/raid grouping (BGs may cross, not Hardcore). PvP ruleset = one faction per account. | same | official |
| F4 | **Dead Hardcore characters can move to other rulesets** → ruleset is a MUTABLE attribute of a character, not part of its identity. | same | official |
| F5 | **Two-part names** (first + second), the full name is **unique within a region**; the second name can be hidden in-world. | https://news.blizzard.com/en-us/article/24304161/... | official |
| F6 | No Forever Game Data / Profile namespace announced; API-forum thread has no staff reply (as of 2026-09-28). `dynamic-classicforever-*` → 403 (ROK-1636 observation). | https://us.forums.blizzard.com/en/blizzard/t/when-will-we-gain-api-access-to-forever-apis/59595 | official (absence) |
| F7 | Third-party armory shell says characters are "found by region, game mode and name". | armorywowforever.com (community, pre-launch shell) | community |
| U1 | Allowed characters / length of each name part; separator (space?) as the Profile API will encode it | — | **UNVERIFIED** |
| U2 | Whether "unique within a region" spans all rulesets (implied by F4 transfers + realmless, not stated verbatim) | — | **UNVERIFIED (likely yes)** |
| U3 | Which regions launch (US/EU certain-ish; KR/TW unconfirmed) | — | **UNVERIFIED** |
| U4 | Profile URL shape for a realmless character (`/profile/wow/character/{realmSlug}/{name}` has no slot for "no realm"; Blizzard may use a pseudo-realm slug per ruleset) | — | **UNKNOWN until launch + probe** |

## 2. What exists today (audit, origin/main @ 3c544b6c1)

### 2.1 Storage
- `api/src/drizzle/schema/characters.ts:36` `name varchar(100) NOT NULL`; `:38` `realm varchar(100)` nullable; `:68` `region varchar(10)`; `:70` `game_variant varchar(30)` (deprecated per contract note, ROK-789 plans to drop it); `:52` `external_id`.
- `:84-89` `UNIQUE unique_user_game_character (user_id, game_id, name, realm)` — **per user only**, and Postgres treats NULL realm as distinct → a realm-less character is never de-duplicated by the DB.
- Forever is its own `games` row: `api/src/games-lookup/seed-games.data.ts:145-152` (slug `world-of-warcraft-forever`, `apiNamespacePrefix: WOW_FOREVER_NAMESPACE_PREFIX`). So "is this a Forever character" = `characters.game_id` → that games row; it must NOT be keyed on `characters.game_variant`.

### 2.2 Contract (`packages/contract/src/characters.schema.ts`)
- `:109-148` `CharacterSchema` — `name` 1..100, `realm` nullable, `region` nullable string.
- `:156-166` `CreateCharacterSchema` — `name`, optional `realm`; **no `region`** (manual create cannot set region today).
- `:182-195` `UpdateCharacterSchema` — `name`, `realm` editable.
- `:251` `WowRegionSchema = us|eu|kr|tw`; `:260-267` `WowGameVariantSchema` already has `wow_forever`.
- `:274-286` `ImportWowCharacterSchema` — `realm` **required** (min 1).

### 2.3 Every place realm / single-word name is assumed
| Anchor | Assumption | Forever impact |
|---|---|---|
| `api/src/characters/characters-import.helpers.ts:32-56` `checkDuplicateClaim` | cross-user claim check by `gameId + ilike(name) + realm`; **returns early when realm is null (`:39`)**; ignores region | manual Forever chars (realm null) get NO cross-user claim check; cross-region false positives if realm reused |
| `characters-crud.helpers.ts:49,67` `buildCreateValues` / `executeCreateTx` | realm passthrough, claim check | needs ruleset + region on create |
| `characters.service.ts:115-118` | maps `unique_user_game_character` violation → 409 "already exists for this game/realm" | NULL realm → never fires for Forever |
| `characters-crud.helpers.ts:137-140` `prepareRefresh` | NotFound when no realm | correct for manual Forever (no refresh); ROK-1722 must relax |
| `characters-crud.helpers.ts:196-205` `syncAllCharacters` | auto-sync selects `region IS NOT NULL AND game_variant IS NOT NULL`; `:265` `char.realm!` | **if manual Forever create sets `game_variant`, the cron will call Blizzard with realm=null** → must leave `game_variant` null (or add a guard) |
| `characters-import.helpers.ts:214-253` `findExistingCharacter` / merge | user+game+name+realm match | ROK-1722 match key must change for Forever |
| `characters-sync.helpers.ts:41-65`, `plugins/plugin-host/extension-points.ts:24,30` | adapter `fetchProfile(name, realm, region, ns)` | adapter interface needs a realmless path (ROK-1722) |
| `api/src/plugins/wow-common/blizzard-character.helpers.ts:26-40` `buildCharacterParams` | slugifies realm, `name.toLowerCase()` → "ana forever" with a space in the URL path | ROK-1722 only |
| `blizzard.controller.ts:63-80` character-preview | `BadRequest('Realm is required')` | ROK-1722 only |
| `api/src/events/invite.helpers.ts:110-133` `resolveBlizzardHints` | inviter's `realm` → realm autocomplete hint | null for Forever — harmless; must not surface a ruleset as a "realm" (Option A hazard) |
| `api/src/admin/games-dedup-unique-conflicts.helpers.ts:10,159`; `api/src/igdb/igdb-dedup-fk-reassign.helpers.ts:383-386` | hard-coded characters unique key `(user_id, name, realm)` used when merging game rows | **any new unique index on characters must be added here** — and Forever has no IGDB id, so it is a dedup candidate |
| `web/src/components/profile/AddCharacterModal.tsx:26,35,55,65` + `character-form-fields.tsx:107-108` | free-text "Realm/Server" input (`showMmoFields`) | Forever variant: ruleset select instead |
| `web/src/components/characters/inline-character-form.tsx:29-35,67,90` | inline (signup-flow) manual form, free-text Realm | same — 2nd surface |
| `web/src/components/onboarding/character-step.tsx:31,37,48,93` | onboarding manual form, free-text Realm | same — 3rd surface |
| `web/src/pages/character-detail-page.tsx:124-131` `CharacterMeta` | shows `realm` after class/spec | show ruleset label for Forever |
| `web/src/pages/invite/invite-components.tsx:43` | `realm - class - spec` subline | show ruleset |
| `web/src/plugins/wow/lib/armory-import.ts:11` | `ARMORY_UNSUPPORTED_VARIANTS = {'wow_forever'}` (ROK-1636 gate) | keep until ROK-1717 flag |
| Roster/signup cards: `SignupCharacterCard.tsx:32`, `SelectableCharacterCard.tsx:46`, `CharacterCard.tsx:45-46`, `EventDetailRoster.tsx:112,163`, `player-card.tsx:81,103` | show `character.name` only, `truncate`; **realm is not displayed in roster/signup** | a two-part name just renders longer; no realm to replace |
| Discord: `pug-invite-member-select.handlers.ts:119-145,255`, `pug-invite-pug-select.handlers.ts:161-239` | signs up / echoes by `character.name`; `resolveCharClassSpec(..., characterName)` looks up by name | a space in the name is fine as long as `name` is the full string (Option B keeps it) |

No embed builder in `api/src/discord-bot/**` renders realm (grep 2026-10-04).

## 3. Identity options

### Option A — reuse `realm` for the ruleset id, `name` = full "First Second"
- Schema/migration: **none**. Contract: add `region` to `CreateCharacterSchema` (still needed — F5).
- Uniqueness: existing `(user_id, game_id, name, realm)` → per-user (name, ruleset). Cross-user via `checkDuplicateClaim` (now fires, realm non-null).
- Armory match: region + lower(name) — but ruleset sits in `realm`, so the ROK-1722 path has to know "realm is not a realm for this game" everywhere `realm` is read.
- Display: every `realm` reader shows "pvp"/"normal" raw unless mapped (detail page, invite card, invite realm hint → realm autocomplete gets "pvp").
- Risks: **ruleset is mutable (F4) but sits inside the identity key** → a Hardcore→Normal move is an edit of a key column and breaks the Armory merge; same full name in two rulesets can be entered twice (F5 says impossible in-game); cross-region false 409s (claim check ignores region). Semantic overload leaks into ROK-1722 forever.

### Option B — new nullable `ruleset` column; `name` keeps the full two-part name; reuse `region` (RECOMMENDED)
- Schema: `ruleset varchar(20) NULL` (values `normal|pvp|roleplaying|hardcore`); `realm` stays NULL for Forever; `region` set on create.
- Uniqueness: a **partial unique index** `(game_id, region, lower(name)) WHERE ruleset IS NOT NULL` — mirrors F5 exactly (region + full name), ruleset excluded because it is mutable (F4). It is cross-user (one real character, one owner) — today that is only an app-level check, so see Q3.
- Armory match (ROK-1722): `game_id + region + lower(name)` → then overwrite `ruleset` from the API; `external_id` (Blizzard character id) becomes the durable key after the first import. Whatever U4 turns out to be (pseudo-realm slug, ruleset slug, or none), it can be derived from `ruleset` inside `buildCharacterParams` — no second migration.
- Display: name renders as-is everywhere (roster, signup, Discord); one helper `characterLocationLabel(char)` returns `realm ?? RULESET_LABEL[ruleset]` for the 2 places that show realm.
- Risks: one migration + dedup-helper update; three web forms change; `checkDuplicateClaim` needs a Forever branch.

### Option C — variant-agnostic `identity jsonb` (`{ kind: 'ruleset', ruleset, region, first, second }`)
- Schema: `identity jsonb NULL`; uniqueness needs an expression index on `(identity->>'region', lower(identity->>'first' || ' ' || identity->>'second'))`.
- Pro: future realmless games fit without new columns. Con: untyped in Drizzle, expression indexes + `jsonb` key ordering pitfalls (memory `reference_jsonb_reorders_object_keys`), every consumer still needs `name` populated for display → duplication. Over-engineered for one variant, 4 weeks before launch.

| | A realm=ruleset | **B ruleset column** | C identity jsonb |
|---|---|---|---|
| Migration | none | 1 (add col + partial unique idx) | 1 (col + expr idx) |
| Contract | +region on create | +region, +ruleset | +identity object |
| Identity key matches F4/F5 | no (ruleset in key) | **yes** | yes |
| ROK-1722 match | awkward | region+name, then external_id | region+first+second |
| Display churn | high (mapping everywhere realm is read) | low (2 call sites) | medium |
| Fits by 2026-10-30 | yes | yes | risky |

## 4. RECOMMENDATION — Option B

**Store the full two-part name in `name` (two inputs in the UI, joined with one space) and add a nullable `ruleset` column; Forever characters carry `region` + `ruleset`, `realm` NULL, and are unique per (game, region, lower(full name)) — ruleset is an editable attribute, not part of the key.** The later Armory import matches on game + region + full name, updates `ruleset` from Blizzard, and pins `external_id`.

### 4.1 Contract (`packages/contract/src/characters.schema.ts`)
```ts
export const WowForeverRulesetSchema = z.enum(['normal', 'pvp', 'roleplaying', 'hardcore']);
export type WowForeverRuleset = z.infer<typeof WowForeverRulesetSchema>;
/** Two parts, single space; letters only per part. U1: tighten once Blizzard publishes the rules. */
export const WowForeverNameSchema = z.string().trim().max(100)
  .regex(/^\p{L}{2,24} \p{L}{2,24}$/u, 'Enter a first and second name');

CharacterSchema      += ruleset: WowForeverRulesetSchema.nullable()
CreateCharacterSchema += region: WowRegionSchema.optional(), ruleset: WowForeverRulesetSchema.optional()
UpdateCharacterSchema += ruleset: WowForeverRulesetSchema.nullable().optional()
                       (region NOT editable — part of the identity; delete + re-add instead. See Q5.)
```
Server-side rule (service, not Zod — Zod cannot see the game row): when the game is the Forever row, require `region` + `ruleset`, validate `name` with `WowForeverNameSchema`, force `realm = null` and leave `game_variant = null` (keeps it out of `syncAllCharacters`, `characters-crud.helpers.ts:196-205`). For any other game, reject `ruleset`.
`hardcore` is in the enum from day one but hidden in the picker until Blizzard opens it (Q2).

### 4.2 Migration (generated LAST; next free number is after `0197_nebulous_garia.sql` — re-check unmerged branches)
```sql
ALTER TABLE "characters" ADD COLUMN "ruleset" varchar(20);
CREATE UNIQUE INDEX "idx_characters_ruleset_identity"
  ON "characters" ("game_id", "region", lower("name"))
  WHERE "ruleset" IS NOT NULL;
```
Self-contained, no backfill (no Forever characters can exist yet — ROK-1636 hid import; a manual one with free-text realm could exist: check `rl_db_query` on prod clone before merge, UNVERIFIED count). Also: add `ruleset_identity` to the characters key lists in `api/src/admin/games-dedup-unique-conflicts.helpers.ts:159` and `api/src/igdb/igdb-dedup-fk-reassign.helpers.ts:386`; map the new index violation to a 409 next to `characters.service.ts:115-118`; extend `checkDuplicateClaim` (`characters-import.helpers.ts:32-56`) with a Forever branch keyed on region + name.

### 4.3 UI fields for ROK-1721 (all three manual surfaces: `AddCharacterModal`/`character-form-fields`, `inline-character-form`, onboarding `character-step`)
When the selected game is the Forever row (by game slug/id, not `game_variant`):
- **Region** — `Select` (US, EU; KR/TW per U3/Q4), default `us`. Required.
- **Ruleset** — `RadioGroup` (Normal, PvP, Roleplaying; Hardcore hidden until enabled). Required. Replaces the Realm/Server input.
- **First name** + **Second name** — two `Input`s in a `Field` row, joined with one space into `name`; inline `Field error` from `WowForeverNameSchema`.
- **Class** — existing field (Forever adds Forsaken Paladin / Dwarf Shaman — combos, not new classes). **Spec** optional. **Role** — existing role select. Main toggle unchanged.
- No realm input, no realm autocomplete, no Blizzard call; Armory tab stays hidden (`armory-import.ts:11`).
- Extract one shared `ForeverIdentityFields` component used by all three surfaces (avoid three copies; keep each file under 300 counted lines).

### 4.4 Display
- Roster/signup/Discord: unchanged — they render `name` (now "Ana Forever"), already `truncate`d.
- Character detail meta (`character-detail-page.tsx:131`) and invite card (`invite-components.tsx:43`): `realm ?? RULESET_LABEL[ruleset]`, plus region suffix only when it differs from the community default (Q6). Optional ruleset chip on `CharacterCard` (Q6).

## 5. Operator decisions (each with a recommendation)

1. **Storage shape: Option B (new `ruleset` column, full name in `name`) over reusing `realm` (A) or a jsonb identity (C)?** — Recommend **B**.
2. **Offer Hardcore in the picker at launch?** — Recommend **no**: store it in the enum, hide it until Blizzard opens the ruleset.
3. **Should a Forever character be globally unique (one owner per region + full name, enforced by a DB index), or per-user like today, with an app-level check for other users?** — Recommend **global DB uniqueness**. F5 makes the name a real-world identity, and the import merge depends on it. Trade-off: someone can squat a name, and the fix is admin delete.
4. **Which regions can players pick at launch: US+EU only, or all four (us/eu/kr/tw)?** — Recommend **all four**, with `us` as the default. The schema already allows all four, and hiding one costs as much as showing it.
5. **Is region editable after creation?** — Recommend **no**. It is part of the identity, so a player deletes the character and adds it again. Ruleset and both name parts stay editable (F4 transfers, typo fixes).
6. **Should roster and character cards show the ruleset (e.g. a "PvP" chip), or only the detail page?** — Recommend **detail page + invite card only at launch**. Raids cannot cross rulesets (F3), so the event's community already implies it. Add a chip later if mixed-ruleset guilds ask for one.
7. **Should name validation start strict (letters only, 2–24 per part) and loosen once Blizzard publishes the rules?** — Recommend **yes**. A strict rule can be relaxed without bad data; a loose one cannot be tightened later.
8. **Should players enter both name parts even though the second can be hidden in-game?** — Recommend **yes, both required**. The full name is the unique key and the Armory match key.

## 6. Mockups

Manual entry (Add Character modal, Forever selected; same fields in the inline signup form and onboarding):
```
+--------------------------------------------------------------+
|  Add Character — World of Warcraft: Forever              [x] |
|  [ Manual ]   Armory import isn't available for WoW Forever   |
|               yet — add the character manually.              |
|--------------------------------------------------------------|
|  Region *            Ruleset *                               |
|  [ US          v ]   ( ) Normal  (o) PvP  ( ) Roleplaying    |
|                                                              |
|  First name *              Second name *                     |
|  [ Ana            ]        [ Forever        ]                |
|  Shown in-game as "Ana Forever" (second name may be hidden)  |
|                                                              |
|  Class                    Spec (optional)                    |
|  [ Paladin       v ]      [ Holy           ]                 |
|  Role *                                                      |
|  [ Healer        v ]                                         |
|  [x] Main character for WoW: Forever                         |
|--------------------------------------------------------------|
|                                   [ Cancel ]  [ Save ]       |
+--------------------------------------------------------------+
 phone (<640px): Region / Ruleset / First / Second stack one per row.
 inline error under the name row: "Enter a first and second name".
 409: "Ana Forever (US) is already claimed by another player".
```

Roster row (event detail, Forever character), and the detail-page meta line:
```
 Roster — Healers (2/5)
 +----------------------------------------------------------+
 | (A)  Ana Forever          Paladin · Holy        [Healer] |
 |      @player                                   Main ★    |
 +----------------------------------------------------------+
 Character detail meta:  60 · Skyborne Elf · Paladin · Holy · PvP (US)
```

## 7. Follow-on lanes for ROK-1721 (budgets in counted lines; each lane ~25 turns)
| Lane | Files | Budget |
|---|---|---|
| L1 contract + schema col | `characters.schema.ts` (+~20), `drizzle/schema/characters.ts` (+~8) | — |
| L2 api create/update/claim | `characters-crud.helpers.ts`, `characters-import.helpers.ts`, `characters.service.ts`, new `characters-forever.helpers.ts` (≤120), dedup key lists ×2; integration spec (real DB): create, 409 cross-user, ruleset edit, sync cron skips Forever | each file stays <300 |
| L3 web | new `components/characters/forever-identity-fields.tsx` (≤150) wired into the 3 forms + `character-detail-page`/`invite-components` label helper; vitest per form | <300 each |
| L4 migration (LAST commit) + `fix-migration-order.sh --check` + `validate-migrations.sh` | | |
Constraints: `tsc --noEmit -p api/tsconfig.json` separate from jest; mutate every new assertion; Playwright smoke desktop + mobile for the Forever add flow; fleet test plan (default-dark + default-light).

## Summary (lane self-report)
- Verified: every anchor in section 2 on 3c544b6c1. The realm-null blind spots (`checkDuplicateClaim:39`, the NULL-distinct unique key) and the auto-sync `game_variant` trap.
- Flagged: U1–U4. A possible pre-existing manual Forever row with free-text realm (needs a prod count). The migration number must be re-checked.
- Not reached: ROK-1718 AC2 (needs launch + probe). Whether `Select` vs `RadioGroup` fits the inline signup form's density (check against design-system 4.11 during L3).

## Operator rulings — 2026-10-04 (APPROVED TARGET)
- Q1 identity model: **Option B approved** — nullable `ruleset` column; `name` = full "First Second"; `region` set; `realm` NULL.
- Q3/Q4/Q5/Q7/Q8: **accepted** — one owner per game + region + lowercased full name across all players (DB-enforced unique index that actually fires — not the NULL-distinct realm key); both name parts required; letters only, 2–24 per part; region locked after creation; all four regions offered, US default.
- Q2: **Hardcore hidden** from the ruleset picker until Blizzard opens it.
- Q6 (where the ruleset is displayed): **Option A — detail page + invite card only; roster rows unchanged** (ruled 2026-10-04 after the roster-row prototype a private claude.ai prototype, link withheld).
