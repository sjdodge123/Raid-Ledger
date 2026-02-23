import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DungeonQuestsService } from './dungeon-quests.service';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from './manifest';

/**
 * API controller for dungeon quest data.
 * All routes gated behind PluginActiveGuard — requires Blizzard plugin to be active.
 *
 * ROK-245: Variant-Aware Dungeon Quest Database
 */
@Controller('plugins/wow-classic')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class DungeonQuestsController {
  constructor(private readonly dungeonQuestsService: DungeonQuestsService) {}

  private static readonly VALID_VARIANTS = new Set([
    'classic_era',
    'classic_anniversary',
    'classic',
    'retail',
  ]);

  /**
   * GET /plugins/wow-classic/instances/:id/quests?variant=classic_era
   *
   * Returns dungeon quests for a specific instance, filtered by variant.
   * Variant determines which expansion's quests are included:
   *   - classic_era: ['classic']
   *   - classic_anniversary: ['classic', 'tbc']
   *   - classic (Cata): ['classic', 'tbc', 'wotlk', 'cata']
   */
  @Get('instances/:id/quests')
  async getQuestsForInstance(
    @Param('id', ParseIntPipe) instanceId: number,
    @Query('variant') variant: string = 'classic_era',
  ) {
    if (!DungeonQuestsController.VALID_VARIANTS.has(variant)) {
      throw new BadRequestException(
        `Invalid variant "${variant}". Valid variants: ${[...DungeonQuestsController.VALID_VARIANTS].join(', ')}`,
      );
    }
    return this.dungeonQuestsService.getQuestsForInstance(instanceId, variant);
  }

  /**
   * GET /plugins/wow-classic/quests/:questId/chain
   *
   * Returns the full prerequisite chain for a quest.
   */
  @Get('quests/:questId/chain')
  async getQuestChain(@Param('questId', ParseIntPipe) questId: number) {
    return this.dungeonQuestsService.getQuestChain(questId);
  }

  /**
   * GET /plugins/wow-classic/instances/:id/quests/enriched?variant=classic_era
   *
   * Returns enriched dungeon quests with resolved reward item details
   * and prerequisite chains.
   *
   * ROK-246: Dungeon Companion — Quest Suggestions UI
   */
  @Get('instances/:id/quests/enriched')
  async getEnrichedQuestsForInstance(
    @Param('id', ParseIntPipe) instanceId: number,
    @Query('variant') variant: string = 'classic_era',
  ) {
    if (!DungeonQuestsController.VALID_VARIANTS.has(variant)) {
      throw new BadRequestException(
        `Invalid variant "${variant}". Valid variants: ${[...DungeonQuestsController.VALID_VARIANTS].join(', ')}`,
      );
    }
    return this.dungeonQuestsService.getEnrichedQuestsForInstance(
      instanceId,
      variant,
    );
  }
}
