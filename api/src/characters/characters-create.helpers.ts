/**
 * Character create path (ROK-1738 split from characters-crud.helpers.ts).
 *
 * `createCharacter` opens its own transaction (the manual Add Character
 * route); `createCharacterWithin` runs the SAME rules — identity prepare,
 * duplicate claim, main/alt — on a transaction the caller already holds, so a
 * plugin can create a character and write related rows atomically. Neither
 * catches inside the transaction: a postgres.js statement failure poisons the
 * whole tx, so violations are mapped only after it has rolled back.
 */
import { ConflictException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterDto, CreateCharacterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { CharacterIdentityProvider } from '../plugins/plugin-host/extension-points';
import type { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  mapCharacterToDto,
  resolveMainStatus,
  demoteExistingMain,
} from './characters-mapping.helpers';
import { checkDuplicateClaim } from './characters-import.helpers';
import { prepareIdentityCreate } from './characters-identity.helpers';
import { isUniqueViolation } from './characters-crud.helpers';
import { defined } from '../common/defined.helpers';

/** A database handle or a transaction from `db.transaction` (repo convention). */
export type CharactersTx = PostgresJsDatabase<typeof schema>;
type Registry = Pick<PluginRegistryService, 'getAdapter' | 'isActive'>;
type Logger = { log: (msg: string) => void };

/** Build insert values for a new character. */
export function buildCreateValues(
  userId: number,
  dto: CreateCharacterDto,
  shouldBeMain: boolean,
) {
  return {
    userId,
    gameId: dto.gameId,
    name: dto.name,
    realm: dto.realm ?? null,
    region: dto.region ?? null,
    ruleset: dto.ruleset ?? null,
    class: dto.class ?? null,
    spec: dto.spec ?? null,
    role: dto.role ?? null,
    isMain: shouldBeMain,
    itemLevel: dto.itemLevel ?? null,
    avatarUrl: dto.avatarUrl ?? null,
  };
}

/** Duplicate claim → main-swap → insert, on the given transaction. */
export async function insertCharacterTx(
  tx: CharactersTx,
  userId: number,
  dto: CreateCharacterDto,
  logger: Logger,
  identity?: CharacterIdentityProvider,
): Promise<CharacterDto> {
  await checkDuplicateClaim(tx, dto.gameId, userId, dto.name, dto.realm, {
    region: dto.region,
    identity,
  });
  const { shouldBeMain, charCount } = await resolveMainStatus(
    tx,
    userId,
    dto.gameId,
    dto.isMain,
  );
  if (shouldBeMain && charCount > 0)
    await demoteExistingMain(tx, userId, dto.gameId);
  const [inserted] = await tx
    .insert(schema.characters)
    .values(buildCreateValues(userId, dto, shouldBeMain))
    .returning();
  const character = defined(inserted, 'created character row');
  logger.log(createdLogLine(userId, character, shouldBeMain));
  return mapCharacterToDto(character);
}

/** Execute the create in its own transaction (main-swap + insert). */
export async function executeCreateTx(
  db: CharactersTx,
  userId: number,
  dto: CreateCharacterDto,
  logger: Logger,
  identity?: CharacterIdentityProvider,
): Promise<CharacterDto> {
  return db.transaction((tx) =>
    insertCharacterTx(tx, userId, dto, logger, identity),
  );
}

function createdLogLine(
  userId: number,
  character: { id: string; name: string },
  isMain: boolean,
): string {
  return `User ${userId} created character ${character.id} (${character.name})${isMain ? ' [main]' : ''}`;
}

/**
 * Map a failed create (thrown AFTER its transaction rolled back) to the
 * user-facing 409s; rethrows anything else unchanged.
 */
export function rethrowCreateViolation(
  error: unknown,
  prepared: CreateCharacterDto,
  identity: CharacterIdentityProvider | undefined,
  requestedName: string = prepared.name,
): never {
  identity?.rethrowIdentityViolation(error, prepared.name, prepared.region);
  if (isUniqueViolation(error, 'unique_user_game_character'))
    throw new ConflictException(
      `Character ${requestedName} already exists for this game/realm`,
    );
  throw error;
}

/** Manual create: identity rules, own transaction, violations → 409. */
export async function createCharacter(
  db: CharactersTx,
  registry: Registry,
  userId: number,
  dto: CreateCharacterDto,
  logger: Logger,
): Promise<CharacterDto> {
  const { prepared, identity } = await prepareIdentityCreate(db, registry, dto);
  try {
    return await executeCreateTx(db, userId, prepared, logger, identity);
  } catch (error: unknown) {
    rethrowCreateViolation(error, prepared, identity, dto.name);
  }
}

/**
 * ROK-1738 — the same create on the CALLER's transaction: no own tx, no
 * savepoint, no catch. A violation aborts the caller's tx; the caller maps it
 * after rollback (`rethrowCreateViolation` or its own code).
 */
export async function createCharacterWithin(
  tx: CharactersTx,
  registry: Registry,
  userId: number,
  dto: CreateCharacterDto,
  logger: Logger,
): Promise<CharacterDto> {
  const { prepared, identity } = await prepareIdentityCreate(tx, registry, dto);
  return insertCharacterTx(tx, userId, prepared, logger, identity);
}
