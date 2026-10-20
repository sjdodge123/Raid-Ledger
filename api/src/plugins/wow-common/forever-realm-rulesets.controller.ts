import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WowForeverRealmRulesetsSchema } from '@raid-ledger/contract';
import type { WowForeverRealmRulesetsDto } from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';
import { ForeverRealmRulesetsService } from './forever-realm-rulesets.service';

const ROUTE = 'admin/plugins/blizzard/forever/realm-rulesets';

/**
 * Admin routes for the WoW: Forever realm → ruleset map (ROK-1739 §5.4).
 * Plugin-gated like the other Forever admin routes, but NOT gated on Blizzard
 * credentials — the map is the fallback for a community without them.
 */
@Controller()
@RequirePlugin('blizzard')
@UseGuards(PluginActiveGuard)
export class ForeverRealmRulesetsController {
  constructor(private readonly realmRulesets: ForeverRealmRulesetsService) {}

  /** GET — the map, sorted by region then realm name. */
  @Get(ROUTE)
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  getMap(): Promise<WowForeverRealmRulesetsDto> {
    return this.realmRulesets.getMap();
  }

  /** PUT — whole-list replace; 400 lists each issue as `<path>: <message>`. */
  @Put(ROUTE)
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  saveMap(@Body() body: unknown): Promise<WowForeverRealmRulesetsDto> {
    const parsed = WowForeverRealmRulesetsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    return this.realmRulesets.saveMap(parsed.data);
  }
}
