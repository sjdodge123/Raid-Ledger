# HANDOVER — ROK-2149 lane L1 (contract + api read)

## Where it is
- Endpoint `GET /plugins/wow/guilds/:id/members/:memberId` is in place: `api/src/plugins/wow-common/guilds/roster-member/` (`controller`, `service`, `queries`, `mapper`, `helpers`, plus `helpers.spec.ts`). It is registered in `guild-hub.registration.ts`.
- Contract: `packages/contract/src/wow-roster-member-character.schema.ts` (barrel-exported), with its spec in `packages/contract/src/__tests__/wow-roster-member-character.schema.spec.ts`.
- **Nothing has been run** (no node_modules; fleet-only). tsc, lint, jest and vitest all still need the fleet gate.

## Still red / not done
- **No integration spec yet** (AC-1..AC-7, the audience-2 omission, the claimed redirect). Next lane: `roster-member/roster-member.integration.spec.ts`, modelled on `join-gate/join-gate.integration.spec.ts` (seeding of the Forever game, hubs, users and tokens). Cases:
  - member: 200 with rank + lastSeen
  - non-member on an unclaimed member of a claimable Forever hub: 200 with no `rank`/`lastSeen` keys
  - non-member on a claimed member: 403
  - non-member on a non-claimable or non-Forever hub: 403
  - hidden hub, non-staff: 404
  - staff: 200
  - member from another guild, or not in the latest snapshot: 404
  - member viewer on a claimed member: `{claimedCharacterId}`
  - snapshot with a different blizzard id: no armory, reason `id_mismatch` or `pending`
  - `linkedAccount` never present
- `toRosterMemberCharacter` runs over 30 lines, so it trips the `max-lines-per-function` **warn** (not an error). It can be split later if wanted.
- Spec Q4=A (insights widening) belongs to L2 and has not been touched.

## Decision: sibling schema, not new fields on CharacterSchema
`CharacterSchema.id` is a uuid and `userId` is an int, and both are required. Putting a non-character in there would widen two fields that every character reader relies on. The sibling schema `CharacterSchema.omit({id,userId,lockouts,enrichments}).extend({...}).strict()` keeps every other field the same shape, so the web only has to normalise two keys.

## Exported names (from `@raid-ledger/contract`)
- `WowRosterMemberCharacterSchema` / `WowRosterMemberCharacterDto`
- `WowRosterMemberClaimedSchema` / `WowRosterMemberClaimedDto`
- `WowRosterMemberResponseSchema` / `WowRosterMemberResponseDto` (a union of the two)
- `RosterMemberNoArmoryReasonSchema` / `RosterMemberNoArmoryReason`
- `RosterMemberRankSchema` / `RosterMemberRank`
- `ROSTER_MEMBER_CHARACTER_ID_PREFIX` (`'roster-member:'`)

## Payload
- **Claimed (members/staff only):** `{ claimedCharacterId: uuid, rosterMemberId, hubId }`. The web checks `'claimedCharacterId' in data` and then does `navigate('/characters/'+id, {replace:true})`.
- **Otherwise,** every CharacterSchema key except `lockouts`/`enrichments`:
  - `id`: `'roster-member:<memberId>'`
  - `userId`: `null`
  - `gameId`: the guild's game
  - `name`: the roster name
  - `realm`: `null` (Forever has no realm)
  - `class` / `level`: snapshot first, else roster
  - `race` / `spec` / `role` / `itemLevel` / `avatarUrl` / `equipment` / `talents`: verified snapshot, else null
  - `professions` and `professionsSource`: from `effectiveProfessions(null, armory)`, the same rule as the character DTO
  - `lastSyncedAt`: the snapshot's `syncedAt`
  - `effectiveRole`: equals `role`; `roleOverride`: `null`
  - `isMain`: `false`
  - `externalId` / `renderUrl` / `faction` / `profileUrl` / `ruleset`: `null`
  - `region`: the guild's region
  - `gameVariant`: `'wow_forever'`
  - `hasManualProfessions`: `false`
  - `displayOrder`: `0`
  - `createdAt` / `updatedAt`: from the roster row
- **Extra fields:**
  - `readOnly: true`
  - `rosterMemberId`
  - `hubId`
  - `canClaim`: the guild is Forever and claimable, and the member is unclaimed
  - `noArmoryReason?`: present only when there is no verified snapshot
  - `rank?: {index, name}`: members audience only
  - `lastSeen?: {online, lastOnlineDays}`: members audience only, when the export reported it; it comes from the roster row, never from `last_login_at`

## Rules the web must follow
- **Never** call a character-keyed endpoint with `id`. That covers `/characters/:id*`, quests, lockouts, installed addons, `guilds/by-character`, refresh/sync and edit.
- When passing the payload to components typed `CharacterDto`, normalise `userId` (for example to `-1`) and gate every owner/admin/slot path on `readOnly`.

## Audience rules as implemented (service)
1. The guard returns 404 for a hidden hub when the viewer is not staff (`HubVisibleGuard`).
2. A guild that does not exist returns 404.
3. If the viewer can't view the hub (`!canView`) and the guild is not a claimable Forever guild, it returns 403 before any member lookup, so no member ids leak.
4. A member who is not in that hub, or not in the latest roster, returns 404.
5. If the viewer can view the hub (`canView`):
   - a claimed member (active owner) returns the redirect shape;
   - otherwise the full payload.
6. If the viewer can't view the hub but the member is unclaimed and the guild is claimable: the payload **without** `rank`/`lastSeen` keys.
7. Anyone else gets 403 (`notMemberError`, `HUB_NOT_MEMBER` code).
