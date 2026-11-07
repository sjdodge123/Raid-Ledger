/**
 * WoW: Forever's character-identity adapter (ROK-1733). Core resolves it via
 * EXTENSION_POINTS.CHARACTER_IDENTITY for the Forever slug and calls it on
 * manual character create/update; every rule lives in the helpers beside it.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  CharacterDto,
  CreateCharacterDto,
  ImportWowCharacterDto,
  UpdateCharacterDto,
} from '@raid-ledger/contract';
import { SettingsService } from '../../settings/settings.service';
import type { EnrichedProfile } from '../../characters/characters-sync.helpers';
import type {
  ExternalImportCtx,
  ExternalImportFields,
  ExternalImportPolicy,
} from '../plugin-host/character-external-import.types';
import type {
  CharacterIdentityProvider,
  IdentityDb,
} from '../plugin-host/extension-points';
import * as forever from './wow-forever-identity.helpers';
import * as foreverImport from './forever-import/forever-import-identity.helpers';
import {
  foreverExternalPolicy,
  isForeverArmoryImportEnabled,
} from './forever-armory-switch';
import { WOW_COMMON_MANIFEST } from './manifest';

@Injectable()
export class WowForeverIdentityProvider implements CharacterIdentityProvider {
  readonly gameSlugs = [forever.WOW_FOREVER_GAME_SLUG];
  readonly pluginSlug = WOW_COMMON_MANIFEST.id;

  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {}

  prepareCreate(
    game: { slug: string },
    dto: CreateCharacterDto,
  ): CreateCharacterDto {
    return forever.prepareCreateDto(game, dto);
  }

  prepareUpdate(
    db: IdentityDb,
    userId: number,
    game: { slug: string },
    character: { id: string; gameId: number; region: string | null },
    dto: UpdateCharacterDto,
  ): Promise<UpdateCharacterDto> {
    return forever.prepareUpdateForGame(db, userId, game, character, dto);
  }

  checkClaim(
    tx: IdentityDb,
    args: { gameId: number; userId: number; name: string; region: string },
  ): Promise<void> {
    return forever.checkRegionClaim(tx, args);
  }

  rethrowIdentityViolation(
    error: unknown,
    name: string,
    region: string | null | undefined,
  ): void {
    forever.rethrowForeverViolation(error, name, region);
  }

  /** ROK-1722: the Forever Armory kill switch + realmless refresh variant. */
  async externalImportPolicy(): Promise<ExternalImportPolicy> {
    return foreverExternalPolicy(
      await isForeverArmoryImportEnabled(this.settings),
    );
  }

  ownsExternalImport(dto: ImportWowCharacterDto): boolean {
    return foreverImport.isForeverImport(dto);
  }

  externalImportFields(
    profile: EnrichedProfile['profile'],
    dto: ImportWowCharacterDto,
  ): ExternalImportFields {
    return foreverImport.importIdentityFields(profile, dto);
  }

  mergeExternalImport(
    tx: IdentityDb,
    ctx: ExternalImportCtx,
  ): Promise<CharacterDto | undefined> {
    return foreverImport.mergeIntoOwnForeverRow(tx, ctx);
  }
}
