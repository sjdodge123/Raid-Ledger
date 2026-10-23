import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../../../../auth/admin.guard';
import { DemoModeGuard } from '../../../../admin/demo-mode.guard';
import { CLAIM_SUGGEST_MIN_AGE_MS } from './valheim-claim-suggest.queries';
import { ValheimClaimSuggestService } from './valheim-claim-suggest.service';

/** `POST /admin/test/valheim/claim-suggest-scan` response. */
export interface ClaimSuggestScanResult {
  /** DMs the scan dispatched. */
  queued: number;
  /** The clock the scan ran at (ISO). */
  now: string;
}

/**
 * ROK-1933 L6a — DEMO_MODE trigger: run ONE claim-suggest scan now instead of
 * waiting for the cron. The scan's clock is pushed past the 10-minute minimum
 * age (+1 min), so a sighting seeded a moment ago already qualifies. Lives in
 * `ValheimModule` (not the demo-seed module) because the service's DM
 * pipeline is wired there.
 */
@Controller('admin/test/valheim')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class ValheimClaimSuggestDemoController {
  constructor(private readonly suggest: ValheimClaimSuggestService) {}

  @Post('claim-suggest-scan')
  @HttpCode(HttpStatus.OK)
  async scan(): Promise<ClaimSuggestScanResult> {
    const now = new Date(Date.now() + CLAIM_SUGGEST_MIN_AGE_MS + 60_000);
    return { queued: await this.suggest.scan(now), now: now.toISOString() };
  }
}
