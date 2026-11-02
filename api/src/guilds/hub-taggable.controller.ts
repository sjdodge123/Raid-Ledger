import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  TaggableHubsQuerySchema,
  type TaggableHubs,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { HubTaggableService } from './hub-taggable.service';

/**
 * ROK-2071 — `GET guilds/taggable?gameId=`: the hubs (any live kind) the
 * viewer may tag an event of that game to. Core, so the event form's Hub
 * field works with the Blizzard plugin off. Its own controller so the
 * literal path registers ahead of `guilds/:id`. The WoW-only
 * `plugins/wow/guilds?gameId=` stays as is.
 */
@Controller('guilds/taggable')
@UseGuards(AuthGuard('jwt'))
export class HubTaggableController {
  constructor(private readonly taggable: HubTaggableService) {}

  @Get()
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<TaggableHubs> {
    const parsed = TaggableHubsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.taggable.listForGame(req.user, parsed.data.gameId);
  }
}
