import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { CompanionConfig } from '@raid-ledger/contract';
import type { CompanionIngestRequest } from '../ingest/companion-ingest-request';
import { CompanionConfigAuthGuard } from './companion-config-auth.guard';
import { CompanionConfigService } from './companion-config.service';

/**
 * `GET /companion/v1/config` (ROK-1956 §8). Optional auth: anonymous callers
 * get `minAppVersion` + limits; a device token or session also gets its rate
 * limits and the contract list. A present but invalid credential is a 401.
 * The global throttler applies (no `@SkipThrottle`) — it is reachable
 * anonymously. `Cache-Control: no-store`: the body depends on the caller.
 */
@Controller('companion/v1/config')
@UseGuards(CompanionConfigAuthGuard)
export class CompanionConfigController {
  constructor(private readonly config: CompanionConfigService) {}

  /** 200 with a `CompanionConfigSchema`-parsed body. */
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Req() req: CompanionIngestRequest): CompanionConfig {
    return this.config.build(req.companionIngest ?? null);
  }
}
