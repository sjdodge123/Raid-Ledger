/**
 * ROK-1271: read-only dedup audit controller.
 *
 * `GET /admin/games/dedup-audit` — JWT-admin-gated. NOT DEMO_MODE gated.
 * Returns dup groups + blast-radius counts for ROK-1270 planning.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  GamesDedupAuditService,
  type DedupAuditResponse,
} from './games-dedup-audit.service';

@RateLimit('admin')
@Controller('admin/games')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class GamesDedupAuditController {
  constructor(private readonly svc: GamesDedupAuditService) {}

  @Get('dedup-audit')
  audit(): Promise<DedupAuditResponse> {
    return this.svc.runAudit();
  }
}
