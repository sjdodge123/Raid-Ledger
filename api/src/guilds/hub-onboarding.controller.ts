import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { HubOnboardingStateDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { HubOnboardingService } from './hub-onboarding.service';

/**
 * ROK-1830 S5 — the hub onboarding prompts' dismissal state (D11-B).
 *
 * Core, not plugin-scoped: the Players-page card is global and the setup
 * checklist is keyed by guild via `?guildId=`. Every route is JWT-guarded and
 * reads `req.user.id`, so a caller can only ever touch their own rows — there
 * is no user id in the path or the body to tamper with.
 */
@Controller('guilds/onboarding')
@UseGuards(AuthGuard('jwt'))
export class HubOnboardingController {
  constructor(private readonly onboarding: HubOnboardingService) {}

  @Get()
  getState(
    @Request() req: AuthenticatedRequest,
  ): Promise<HubOnboardingStateDto> {
    return this.onboarding.getState(req.user.id);
  }

  @Post(':key/dismiss')
  @HttpCode(200)
  dismiss(
    @Request() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Query() query: unknown,
  ): Promise<HubOnboardingStateDto> {
    return this.onboarding.dismiss(req.user, key, query);
  }

  @Delete(':key/dismiss')
  restore(
    @Request() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Query() query: unknown,
  ): Promise<HubOnboardingStateDto> {
    return this.onboarding.restore(req.user, key, query);
  }
}
