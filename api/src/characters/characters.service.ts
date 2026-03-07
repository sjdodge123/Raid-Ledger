import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
  buildSyncUpdateFields,
} from './characters-sync.helpers';
import {
  mapCharacterToDto,
  demoteExistingMain,
} from './characters-mapping.helpers';
import * as importH from './characters-import.helpers';
import * as crudH from './characters-crud.helpers';

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
    const [game] = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, dto.gameId))
      .limit(1);
    if (!game) throw new NotFoundException(`Game ${dto.gameId} not found`);
    try {
      return await crudH.executeCreateTx(this.db, userId, dto, this.logger);
    } catch (error: unknown) {
      if (crudH.isUniqueViolation(error, 'unique_user_game_character'))
        throw new ConflictException(
          `Character ${dto.name} already exists for this game/realm`,
        );
      throw error;
    }
  }

  async update(
    userId: number,
    characterId: string,
    dto: UpdateCharacterDto,
  ): Promise<CharacterDto> {
    await this.findOne(userId, characterId);
    const [updated] = await this.db
      .update(schema.characters)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(schema.characters.id, characterId))
      .returning();
    this.logger.log(`User ${userId} updated character ${characterId}`);
    return mapCharacterToDto(updated);
  }

  async delete(userId: number, characterId: string): Promise<void> {
    const character = await this.findOne(userId, characterId);
    await this.db
      .delete(schema.characters)
      .where(eq(schema.characters.id, characterId));
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
        .where(eq(schema.characters.id, characterId))
        .returning();
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
    const adapter = this.findCharacterSyncAdapter(dto.gameVariant);
    if (!adapter)
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    const fetched = await fetchFullProfile(
      adapter,
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );
    await importH.validateUserExists(this.db, userId);
    const game = await importH.resolveGameByVariant(
      this.db,
      adapter,
      dto.gameVariant,
    );
    return importH.insertOrMergeImport(
      this.db,
      userId,
      game.id,
      fetched,
      dto,
      this.logger,
      crudH.isUniqueViolation,
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
    );
    const { profile, talents, equipment } = await fetchFullProfile(
      adapter,
      character.name,
      character.realm!,
      region,
      gameVariant,
    );
    const fields = buildSyncUpdateFields(profile, equipment, talents, {
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
    const dto = mapCharacterToDto(character);
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
    );
  }
}
