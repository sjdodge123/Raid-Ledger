import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CharacterDto,
  CharacterListResponseDto,
  CreateCharacterDto,
  UpdateCharacterDto,
  ImportWowCharacterDto,
  RefreshCharacterDto,
} from '@raid-ledger/contract';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import { EnrichmentsService } from '../enrichments/enrichments.service';
import {
  fetchFullProfile,
  buildSyncUpdateFieldsFromSync,
} from './characters-sync.helpers';
import {
  mapCharacterToDto,
  demoteExistingMain,
} from './characters-mapping.helpers';
import * as importH from './characters-import.helpers';
import * as crudH from './characters-crud.helpers';
import * as createH from './characters-create.helpers';
import * as identityH from './characters-identity.helpers';
import { checkUpdateClaim } from './characters-update-claim.helpers';
import { isRosterClaimed } from './characters-roster-claim.helpers';
import { withDisplayOverrides } from './characters-display-equipment.helpers';
import * as policyH from './characters-external-policy.helpers';

/**
 * Service for managing player characters (ROK-130).
 * Supports Main/Alt designation with enforced single main per game.
 */
@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly enrichmentsService: EnrichmentsService,
  ) {}

  private findCharacterSyncAdapter(
    gameVariant?: string,
  ): CharacterSyncAdapter | undefined {
    const adapters =
      this.pluginRegistry.getAdaptersForExtensionPoint<CharacterSyncAdapter>(
        EXTENSION_POINTS.CHARACTER_SYNC,
      );
    const seen = new Set<CharacterSyncAdapter>();
    for (const [, adapter] of adapters) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      if (adapter.resolveGameSlugs(gameVariant).length > 0) return adapter;
    }
    return undefined;
  }

  async getAvatarUrlByName(
    userId: number,
    characterName: string,
  ): Promise<string | null> {
    const [result] = await this.db
      .select({ avatarUrl: schema.characters.avatarUrl })
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.name, characterName),
        ),
      )
      .limit(1);
    return result?.avatarUrl ?? null;
  }

  async findAllForUser(
    userId: number,
    gameId?: number,
  ): Promise<CharacterListResponseDto> {
    const conditions = [eq(schema.characters.userId, userId)];
    if (gameId) conditions.push(eq(schema.characters.gameId, gameId));
    const chars = await this.db
      .select()
      .from(schema.characters)
      .where(and(...conditions))
      .orderBy(asc(schema.characters.displayOrder));
    return {
      data: chars.map((row) => mapCharacterToDto(row)),
      meta: { total: chars.length },
    };
  }

  async findOne(userId: number, characterId: string): Promise<CharacterDto> {
    return crudH.findOneOwned(this.db, userId, characterId);
  }

  async create(userId: number, dto: CreateCharacterDto): Promise<CharacterDto> {
    const registry = this.pluginRegistry;
    return createH.createCharacter(this.db, registry, userId, dto, this.logger);
  }

  /**
   * ROK-1738 — create on the CALLER's transaction (same identity, duplicate
   * and main/alt rules as `create`). Opens no tx and catches nothing: a
   * violation aborts the caller's tx, which maps it after rollback.
   */
  async createWithin(
    tx: createH.CharactersTx,
    userId: number,
    dto: CreateCharacterDto,
  ): Promise<CharacterDto> {
    const registry = this.pluginRegistry;
    return createH.createCharacterWithin(
      tx,
      registry,
      userId,
      dto,
      this.logger,
    );
  }

  async update(
    userId: number,
    characterId: string,
    dto: UpdateCharacterDto,
  ): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);
    const { prepared, identity } = await identityH.prepareIdentityUpdate(
      this.db,
      this.pluginRegistry,
      userId,
      character,
      dto,
    );
    await checkUpdateClaim(this.db, userId, character, prepared);
    const [updated] = await this.db
      .update(schema.characters)
      .set({ ...prepared, updatedAt: new Date() })
      .where(crudH.ownedCharacter(userId, characterId))
      .returning()
      .catch((error: unknown) => {
        const name = prepared.name ?? character.name;
        identity?.rethrowIdentityViolation(error, name, character.region);
        throw error;
      });
    // An admin Change owner committed after findOne (ROK-2128 Codex P1).
    if (!updated) throw new NotFoundException('Character not found');
    this.logger.log(`User ${userId} updated character ${characterId}`);
    return mapCharacterToDto(updated);
  }

  async delete(userId: number, characterId: string): Promise<void> {
    const character = await this.findOne(userId, characterId);
    await crudH.deleteOwnedCharacter(this.db, userId, characterId);
    await crudH.autoPromoteAfterDelete(
      this.db,
      userId,
      character.gameId,
      this.logger,
    );
    this.logger.log(`User ${userId} deleted character ${characterId}`);
  }

  async setMain(userId: number, characterId: string): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);
    return this.db.transaction(async (tx) => {
      await demoteExistingMain(tx, userId, character.gameId);
      const [updated] = await tx
        .update(schema.characters)
        .set({ isMain: true, updatedAt: new Date() })
        .where(crudH.ownedCharacter(userId, characterId))
        .returning();
      // Moved to another owner mid-request: 404 (rolls back the demote).
      if (!updated) throw new NotFoundException('Character not found');
      this.logger.log(
        `User ${userId} set character ${characterId} as main for game ${character.gameId}`,
      );
      return mapCharacterToDto(updated);
    });
  }

  async importExternal(
    userId: number,
    dto: ImportWowCharacterDto,
  ): Promise<CharacterDto> {
    (await policyH.loadExternalPolicy(this.pluginRegistry)).assertAllowed(
      dto.gameVariant,
    );
    const adapter = this.findCharacterSyncAdapter(dto.gameVariant);
    if (!adapter)
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    await importH.validateUserExists(this.db, userId);
    const game = await importH.resolveGameByVariant(
      this.db,
      adapter,
      dto.gameVariant,
    );
    const fetched = await fetchFullProfile(
      adapter,
      dto.name,
      dto.realm,
      dto.region,
      game.apiNamespacePrefix ?? null,
    );
    return importH.insertOrMergeImport(
      this.db,
      userId,
      game.id,
      fetched,
      dto,
      this.logger,
      crudH.isUniqueViolation,
      policyH.externalImportOwner(this.pluginRegistry, dto),
    );
  }

  async refreshExternal(
    userId: number,
    characterId: string,
    dto: RefreshCharacterDto,
  ): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);
    const { region, gameVariant, adapter } = crudH.prepareRefresh(
      character,
      dto,
      (v) => this.findCharacterSyncAdapter(v),
      await policyH.loadExternalPolicy(this.pluginRegistry),
    );
    const nsPrefix = await crudH.resolveNsPrefix(this.db, character.gameId);
    const fetched = await fetchFullProfile(
      adapter,
      character.name,
      character.realm,
      region,
      nsPrefix,
    );
    const fields = buildSyncUpdateFieldsFromSync(fetched.profile, fetched, {
      region,
      gameVariant,
    });
    const result = await crudH.applyRefreshUpdate(
      this.db,
      userId,
      characterId,
      fields,
      this.logger,
    );
    this.enqueueEnrichmentsBackground(characterId, character.gameId);
    return result;
  }

  private enqueueEnrichmentsBackground(
    characterId: string,
    gameId: number,
  ): void {
    this.db
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1)
      .then(([game]) => {
        if (game)
          return this.enrichmentsService.enqueueCharacterEnrichments(
            characterId,
            game.slug,
          );
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to enqueue enrichments for character ${characterId}: ${err}`,
        );
      });
  }

  async findOnePublic(characterId: string): Promise<CharacterDto> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    if (!character)
      throw new NotFoundException(`Character ${characterId} not found`);
    const dto = {
      ...(await withDisplayOverrides(
        mapCharacterToDto(character),
        this.findCharacterSyncAdapter(character.gameVariant ?? undefined),
        this.logger,
      )),
      rosterClaimed: await isRosterClaimed(this.db, characterId),
    };
    const enrichmentRows =
      await this.enrichmentsService.getEnrichmentsForEntity(
        'character',
        characterId,
      );
    return enrichmentRows.length > 0
      ? { ...dto, enrichments: enrichmentRows }
      : dto;
  }

  async syncAllCharacters(): Promise<{
    synced: number;
    failed: number;
  }> {
    return crudH.syncAllCharacters(
      this.db,
      (v) => this.findCharacterSyncAdapter(v),
      this.logger,
      await policyH.loadExternalPolicy(this.pluginRegistry),
    );
  }
}
