/**
 * Plugin-owned identity rules for manual characters (ROK-1733).
 *
 * Core looks up the game, asks the plugin registry for a character-identity
 * provider for its slug, and lets the provider validate + normalize the DTO.
 * With no provider (no plugin claims the game, or its plugin is off), the
 * identity fields are refused outright.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateCharacterDto,
  UpdateCharacterDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { CharacterIdentityProvider } from '../plugins/plugin-host/extension-points';
import type { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

type Db = PostgresJsDatabase<typeof schema>;
type Registry = Pick<PluginRegistryService, 'getAdapter'>;
type CharacterRef = { id: string; gameId: number; region: string | null };

/** A prepared DTO plus the provider (if any) that owns the game's identity. */
export interface IdentityPrepared<T> {
  prepared: T;
  identity: CharacterIdentityProvider | undefined;
}

export function resolveIdentity(
  registry: Registry,
  slug: string,
): CharacterIdentityProvider | undefined {
  return registry.getAdapter<CharacterIdentityProvider>(
    EXTENSION_POINTS.CHARACTER_IDENTITY,
    slug,
  );
}

/** No provider: a create may not carry identity fields. */
export function rejectIdentityFields(
  dto: CreateCharacterDto,
): CreateCharacterDto {
  if (dto.region !== undefined || dto.ruleset !== undefined)
    throw new BadRequestException(
      'Region and ruleset do not apply to this game',
    );
  return dto;
}

/** No provider: an update may not carry a ruleset. */
export function rejectRulesetField(
  dto: UpdateCharacterDto,
): UpdateCharacterDto {
  if (dto.ruleset !== undefined)
    throw new BadRequestException('Ruleset does not apply to this game');
  return dto;
}

async function findGameSlug(
  db: Db,
  gameId: number,
): Promise<{ slug: string } | undefined> {
  const [game] = await db
    .select({ slug: schema.games.slug })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game;
}

/** Look up the create's game (404 if missing) and apply its identity rules. */
export async function prepareIdentityCreate(
  db: Db,
  registry: Registry,
  dto: CreateCharacterDto,
): Promise<IdentityPrepared<CreateCharacterDto>> {
  const game = await findGameSlug(db, dto.gameId);
  if (!game) throw new NotFoundException(`Game ${dto.gameId} not found`);
  const identity = resolveIdentity(registry, game.slug);
  const prepared = identity
    ? identity.prepareCreate(game, dto)
    : rejectIdentityFields(dto);
  return { prepared, identity };
}

/** Apply the character's game identity rules to an update. */
export async function prepareIdentityUpdate(
  db: Db,
  registry: Registry,
  userId: number,
  character: CharacterRef,
  dto: UpdateCharacterDto,
): Promise<IdentityPrepared<UpdateCharacterDto>> {
  const game = (await findGameSlug(db, character.gameId)) ?? { slug: '' };
  const identity = resolveIdentity(registry, game.slug);
  const prepared = identity
    ? await identity.prepareUpdate(db, userId, game, character, dto)
    : rejectRulesetField(dto);
  return { prepared, identity };
}

/** Claim options for a realm-less character, threaded through the create tx. */
export interface IdentityClaimOpts {
  region?: string | null;
  identity?: CharacterIdentityProvider | undefined;
}

/** Realm-less claim check: only a game with a provider keys on region. */
export async function checkIdentityClaim(
  tx: Db,
  args: { gameId: number; userId: number; name: string },
  opts: IdentityClaimOpts,
): Promise<void> {
  if (opts.region && opts.identity)
    await opts.identity.checkClaim(tx, { ...args, region: opts.region });
}
