/**
 * WoW: Forever character identity (ROK-1721).
 *
 * Forever is realmless: a character is identified by game + region + full
 * two-part name (case-insensitive) across ALL players, and carries a mutable
 * ruleset. Realm stays NULL and game_variant stays NULL so the nightly Armory
 * auto-sync never picks the character up.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  WowForeverNameSchema,
  type CreateCharacterDto,
  type UpdateCharacterDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type GameRef = { slug: string };

export const WOW_FOREVER_GAME_SLUG = 'world-of-warcraft-forever';
export const FOREVER_IDENTITY_INDEX = 'idx_characters_ruleset_identity';

export function isForeverGame(game: GameRef | null | undefined): boolean {
  return game?.slug === WOW_FOREVER_GAME_SLUG;
}

/** Display key used in every Forever conflict message: "Ana Forever (US)". */
export function foreverLabel(name: string, region: string): string {
  return `${name} (${region.toUpperCase()})`;
}

function parseForeverName(name: string): string {
  const parsed = WowForeverNameSchema.safeParse(name);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Enter a first and second name',
    );
  return parsed.data;
}

/** Validate a create DTO against its game and return the normalized DTO. */
export function prepareCreateDto(
  game: GameRef,
  dto: CreateCharacterDto,
): CreateCharacterDto {
  if (!isForeverGame(game)) {
    if (dto.region !== undefined || dto.ruleset !== undefined)
      throw new BadRequestException(
        'Region and ruleset only apply to WoW: Forever characters',
      );
    return dto;
  }
  if (!dto.region || !dto.ruleset)
    throw new BadRequestException(
      'WoW: Forever characters need a region and a ruleset',
    );
  return { ...dto, name: parseForeverName(dto.name), realm: undefined };
}

/** Validate an update DTO against its game and return the normalized DTO. */
export function prepareUpdateDto(
  game: GameRef,
  dto: UpdateCharacterDto,
): UpdateCharacterDto {
  if (!isForeverGame(game)) {
    if (dto.ruleset !== undefined)
      throw new BadRequestException(
        'Ruleset only applies to WoW: Forever characters',
      );
    return dto;
  }
  if (dto.realm)
    throw new BadRequestException('WoW: Forever characters have no realm');
  if (dto.name === undefined) return dto;
  return { ...dto, name: parseForeverName(dto.name) };
}

/**
 * Region + full-name claim check (realm-less characters). Excludes the
 * character being edited; tells the caller apart from another player.
 */
export async function checkRegionClaim(
  tx: Db,
  args: {
    gameId: number;
    userId: number;
    name: string;
    region: string;
    excludeId?: string;
  },
): Promise<void> {
  const conditions = [
    eq(schema.characters.gameId, args.gameId),
    eq(schema.characters.region, args.region),
    sql`lower(${schema.characters.name}) = lower(${args.name})`,
  ];
  if (args.excludeId) conditions.push(ne(schema.characters.id, args.excludeId));
  const [existing] = await tx
    .select({ userId: schema.characters.userId })
    .from(schema.characters)
    .where(and(...conditions))
    .limit(1);
  if (!existing) return;
  const label = foreverLabel(args.name, args.region);
  throw new ConflictException(
    existing.userId === args.userId
      ? `${label} is already on your character list`
      : `${label} is already claimed by another player`,
  );
}

/**
 * A Forever-game row created before regions existed (region NULL) has no
 * Forever identity: it keeps its old free-form name, and a ruleset is refused
 * because the identity index only covers rows that carry a region.
 */
function prepareLegacyUpdate(dto: UpdateCharacterDto): UpdateCharacterDto {
  if (dto.ruleset !== undefined)
    throw new BadRequestException(
      'This character has no region, so it cannot take a ruleset. Delete it and add it again to pick a region and ruleset.',
    );
  return dto;
}

/**
 * Validate an update against the character's game and, for a Forever rename,
 * run the region claim check. Region itself is rejected by the contract.
 */
export async function prepareCharacterUpdate(
  db: Db,
  userId: number,
  character: { id: string; gameId: number; region: string | null },
  dto: UpdateCharacterDto,
): Promise<UpdateCharacterDto> {
  const [game] = await db
    .select({ slug: schema.games.slug })
    .from(schema.games)
    .where(eq(schema.games.id, character.gameId))
    .limit(1);
  if (isForeverGame(game) && !character.region) return prepareLegacyUpdate(dto);
  const prepared = prepareUpdateDto(game ?? { slug: '' }, dto);
  if (isForeverGame(game) && prepared.name && character.region)
    await checkRegionClaim(db, {
      gameId: character.gameId,
      userId,
      name: prepared.name,
      region: character.region,
      excludeId: character.id,
    });
  return prepared;
}
