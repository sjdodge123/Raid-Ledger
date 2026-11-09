/**
 * ROK-2149 — the optional `withArmorySnapshots: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: a verified roster Armory
 * snapshot (`guild_member_armory`) for every UNLINKED roster row except the
 * last, so the read-only roster-member page renders Equipment, Talents and
 * Professions for one and the "No Armory data" note for the other.
 *
 * Each snapshotted row also gets a synthetic roster Blizzard id (the snapshot
 * is verified against it) and the roster's own last-online facts, so "Last
 * seen" renders. `last_login_at` stays null: the page must never read it.
 * Writes go through the real writer (`writeMemberSnapshot`), so the row shape
 * is the roster Armory pass's. A fresh `synced_at` + matching roster level
 * keeps the hourly pass from treating the member as due.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CharacterEquipmentDto,
  CharacterProfessionsDto,
  EquipmentItemDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { writeMemberSnapshot } from '../plugins/wow-common/forever-armory-snapshot/snapshot.apply';
import type { MemberArmorySnapshot } from '../plugins/wow-common/forever-armory-snapshot/snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Synthetic Blizzard ids live far above real ones' seeded range. */
const SEED_BLIZZARD_ID_BASE = 910_000_000;
/** Matches the seeded roster rows' level (`MEMBER_BASE`). */
const SEED_ROSTER_LEVEL = 60;

export interface SeededArmorySnapshots {
  /** Unlinked roster rows that carry a verified snapshot. */
  memberIds: number[];
  /** Unlinked roster rows left without one (the "No Armory data" path). */
  withoutSnapshot: number[];
}

/** The deterministic synthetic roster Blizzard id of a seeded member. */
export function seedArmoryBlizzardId(memberId: number): number {
  return SEED_BLIZZARD_ID_BASE + memberId;
}

/** Every unlinked row but the last gets a snapshot. */
export function seedArmorySplit(
  unlinked: readonly number[],
): SeededArmorySnapshots {
  return {
    memberIds: unlinked.slice(0, -1),
    withoutSnapshot: unlinked.slice(-1),
  };
}

function epic(
  slot: string,
  itemId: number,
  name: string,
  itemSubclass: string,
): EquipmentItemDto {
  return { slot, itemId, name, quality: 'EPIC', itemLevel: 63, itemSubclass };
}

function seedEquipment(now: Date): CharacterEquipmentDto {
  return {
    equippedItemLevel: 63,
    items: [
      epic('HEAD', 12640, 'Lionheart Helm', 'Plate'),
      epic('CHEST', 11726, 'Savage Gladiator Chain', 'Mail'),
      epic('MAIN_HAND', 12784, 'Arcanite Reaper', 'Axe'),
    ],
    syncedAt: now.toISOString(),
    source: 'armory',
  };
}

function talent(
  name: string,
  spellId: number,
  rank: number,
  tier: number,
  col: number,
) {
  return { name, spellId, rank, tierIndex: tier, columnIndex: col };
}

/** The classic Blizzard `specializations` shape (`buildClassicTalentData`). */
function seedTalents() {
  return {
    format: 'classic' as const,
    trees: [
      {
        name: 'Arms',
        spentPoints: 31,
        talents: [
          talent('Tactical Mastery', 12295, 5, 1, 1),
          talent('Anger Management', 12296, 1, 2, 0),
          talent('Sweeping Strikes', 12292, 1, 4, 1),
          talent('Mortal Strike', 12294, 1, 6, 1),
        ],
      },
      {
        name: 'Fury',
        spentPoints: 20,
        talents: [
          talent('Enrage', 12317, 5, 3, 2),
          talent('Death Wish', 12328, 1, 4, 1),
        ],
      },
      { name: 'Protection', spentPoints: 0, talents: [] },
    ],
    summary: '31/20/0',
  };
}

function seedProfessions(now: Date): CharacterProfessionsDto {
  const prof = (id: number, name: string, slug: string) => ({
    id,
    name,
    slug,
    skillLevel: 300,
    maxSkillLevel: 300,
    tiers: [],
  });
  return {
    primary: [
      prof(164, 'Blacksmithing', 'blacksmithing'),
      prof(186, 'Mining', 'mining'),
    ],
    secondary: [],
    syncedAt: now.toISOString(),
  };
}

/** A verified level-60 Arms Warrior snapshot for `blizzardId`, synced at `now`. */
export function buildSeedArmorySnapshot(
  blizzardId: number,
  now: Date,
): MemberArmorySnapshot {
  return {
    blizzardCharacterId: blizzardId,
    level: SEED_ROSTER_LEVEL,
    class: 'Warrior',
    race: 'Human',
    spec: 'Arms',
    role: 'dps',
    itemLevel: 63,
    avatarUrl:
      'https://wow.zamimg.com/images/wow/icons/large/classicon_warrior.jpg',
    equipment: seedEquipment(now),
    talents: seedTalents(),
    armoryProfessions: seedProfessions(now),
    lastLoginAt: null,
    syncedAt: now,
  };
}

/** Roster Blizzard id + last-online on the row, then the snapshot upsert. */
async function seedOne(db: Db, memberId: number, now: Date): Promise<void> {
  const blizzardId = seedArmoryBlizzardId(memberId);
  await db
    .update(schema.guildMembers)
    .set({
      blizzardCharacterId: blizzardId,
      onlineAtExport: false,
      lastOnlineDays: 1,
    })
    .where(eq(schema.guildMembers.id, memberId));
  await writeMemberSnapshot(
    db,
    { memberId, blizzardId, rosterLevel: SEED_ROSTER_LEVEL },
    buildSeedArmorySnapshot(blizzardId, now),
    now,
  );
}

/**
 * Writes the snapshots for `seedArmorySplit(unlinked).memberIds`. Idempotent:
 * the roster update and the snapshot upsert rewrite the same values.
 */
export async function seedGuildArmorySnapshots(
  db: Db,
  unlinked: readonly number[],
  now: Date,
): Promise<SeededArmorySnapshots> {
  const split = seedArmorySplit(unlinked);
  for (const memberId of split.memberIds) {
    await seedOne(db, memberId, now);
  }
  return split;
}

/** The opt-in half: `{ armorySnapshots }` when `withArmorySnapshots`, else `{}`. */
export async function seedArmoryHalf(
  db: Db,
  input: { withArmorySnapshots: boolean },
  unlinked: readonly number[],
  now: Date,
): Promise<{ armorySnapshots?: SeededArmorySnapshots }> {
  if (!input.withArmorySnapshots) return {};
  return { armorySnapshots: await seedGuildArmorySnapshots(db, unlinked, now) };
}
