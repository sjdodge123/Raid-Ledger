import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type {
  CharacterSyncAdapter,
  DisplayEquipmentRow,
  DisplayLockoutsRow,
  DisplayTalentsRow,
} from '../plugin-host/extension-points';
import type {
  CharacterEquipmentDto,
  CharacterLockoutsDto,
  ForeverTalentsDto,
} from '@raid-ledger/contract';
import { ForeverDisplayEquipmentService } from './forever-display-equipment.service';
import { WowDisplayTooltipService } from './wow-display-tooltip.service';
import { ForeverDisplayTalentsService } from './forever-display-talents.service';
import { ForeverDisplayLockoutsService } from './forever-display-lockouts.service';
import type {
  ExternalCharacterProfile,
  ExternalInferredSpecialization,
  ExternalCharacterEquipment,
  ExternalCharacterProfessions,
  ExternalCharacterQuests,
} from '../plugin-host/extension-types';
import { ALL_WOW_GAME_SLUGS } from './manifest';

/**
 * ROK-2176 review MAJOR 2: the vanilla-era `characters.game_variant` values
 * (`WowGameVariantSchema`) whose gear Wowhead dataEnv 16 / 4 can describe.
 * `retail`, `classic` (Cata/MoP progression) and `classic_anniversary` (its
 * realms are in TBC — envs 16/4 serve no TBC items, so every probe would be
 * a guaranteed miss on the shared ≤1 req/s queue) are excluded.
 */
const TOOLTIP_VARIANTS: ReadonlySet<string> = new Set([
  'wow_forever',
  'classic_era',
]);

/** Addon gear: `ForeverDisplayEquipmentService.resolve` owns its enqueue. */
const ADDON_DECORATE = { enqueueDue: false } as const;

function isTooltipVariant(variant: string | null): boolean {
  return variant !== null && TOOLTIP_VARIANTS.has(variant);
}

/**
 * Adapter bridging CharacterSyncAdapter interface to BlizzardService.
 * The `gameVariant` parameter now carries the game's apiNamespacePrefix
 * (null for retail, e.g. 'classic1x', 'classicann').
 */
@Injectable()
export class BlizzardCharacterSyncAdapter implements CharacterSyncAdapter {
  readonly gameSlugs = ALL_WOW_GAME_SLUGS;

  constructor(
    private readonly blizzardService: BlizzardService,
    private readonly foreverEquipment: ForeverDisplayEquipmentService,
    private readonly foreverTalents: ForeverDisplayTalentsService,
    private readonly foreverLockouts: ForeverDisplayLockoutsService,
    private readonly tooltips: WowDisplayTooltipService,
  ) {}

  /**
   * ROK-1727: Forever characters display their addon snapshot gear.
   * ROK-2176: that gear, else (vanilla-era variants only) the stored Armory
   * gear, comes back as a copy carrying each item's stored Wowhead tooltip
   * (undefined = no gear at all). Addon gear is Forever by definition, so it
   * is decorated even when the character's `gameVariant` is null (manual /
   * roster-created). Armory gear of retail / progression Classic / TBC
   * Anniversary / no variant keeps the pre-2176 result.
   * The Forever resolver already enqueued the addon gear's due ids, so the
   * addon branch decorates without a second enqueue (one per id per read).
   */
  async resolveDisplayEquipment(
    row: DisplayEquipmentRow,
  ): Promise<CharacterEquipmentDto | undefined> {
    const addon = await this.foreverEquipment.resolve(row);
    if (addon) return this.tooltips.decorate(row, addon, ADDON_DECORATE);
    if (!isTooltipVariant(row.gameVariant) || !row.equipment) return undefined;
    return this.tooltips.decorate(row, row.equipment);
  }

  /** ROK-1744: Forever talents from the LedgerLink snapshot. */
  resolveDisplayTalents(
    row: DisplayTalentsRow,
  ): Promise<ForeverTalentsDto | undefined> {
    return this.foreverTalents.resolve(row);
  }

  /** ROK-1743: Forever saved instances from the LedgerLink snapshot. */
  resolveDisplayLockouts(
    row: DisplayLockoutsRow,
  ): Promise<CharacterLockoutsDto | undefined> {
    return this.foreverLockouts.resolve(row);
  }

  /** @deprecated Game ID is now the lookup key; kept for interface compat. */
  resolveGameSlugs(gameVariant?: string): string[] {
    if (!gameVariant) return ALL_WOW_GAME_SLUGS;
    return ALL_WOW_GAME_SLUGS;
  }

  async fetchProfile(
    name: string,
    realm: string | null,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterProfile> {
    return this.blizzardService.fetchCharacterProfile(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
  }

  async fetchSpecialization(
    name: string,
    realm: string | null,
    region: string,
    characterClass: string,
    gameVariant?: string,
  ): Promise<ExternalInferredSpecialization> {
    return this.blizzardService.fetchCharacterSpecializations(
      name,
      realm,
      region,
      characterClass,
      gameVariant ?? null,
    );
  }

  /**
   * Thin pass-through, null included: a failed fetch must not become an empty
   * item list, or the sync would overwrite the stored gear. The orchestrator
   * omits the `equipment` key on null (same keep-prior rule as professions).
   */
  async fetchEquipment(
    name: string,
    realm: string | null,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterEquipment | null> {
    return this.blizzardService.fetchCharacterEquipment(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
  }

  /**
   * Thin pass-through: returns the service result as-is, including null
   * (architect §3 — orchestrator's `if (professions !== null)` is the only
   * source of "skip the column" behavior; do NOT fall back to empty arrays).
   */
  async fetchProfessions(
    name: string,
    realm: string | null,
    region: string,
    gameVariant?: string | null,
  ): Promise<ExternalCharacterProfessions | null> {
    return this.blizzardService.fetchCharacterProfessions(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
  }

  /** ROK-2109: Forever completed quest ids; null = leave armory_quests alone. */
  async fetchQuests(
    name: string,
    realm: string | null,
    region: string,
    gameVariant?: string | null,
  ): Promise<ExternalCharacterQuests | null> {
    return this.blizzardService.fetchCharacterQuests(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
  }
}
