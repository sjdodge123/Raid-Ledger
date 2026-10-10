import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type { CharacterQuestsResponse } from '@raid-ledger/contract';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from './manifest';
import { CharacterQuestsService } from './character-quests.service';

/**
 * ROK-1745: quest section of the character page. Public like the rest of the
 * character page (D3 / R-1) — no JWT guard; plugin-gated only.
 */
@Controller('plugins/wow/characters')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class CharacterQuestsController {
  constructor(private readonly quests: CharacterQuestsService) {}

  /** GET /plugins/wow/characters/:id/quests → `{ quests }`, null when hidden (D2). */
  @Get(':id/quests')
  async getQuests(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CharacterQuestsResponse> {
    return { quests: await this.quests.getForCharacter(id) };
  }
}
