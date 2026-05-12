/**
 * ROK-1271 + ROK-1270: dedup audit controller.
 *
 * `GET /admin/games/dedup-audit`     — read-only (ROK-1271).
 * `POST /admin/games/dedup-audit/run` — TRUNCATE+INSERT into
 *   `games_dedup_audit` table and return a compact summary (ROK-1270).
 *
 * Both are JWT-admin-gated via the class-level guards. NOT DEMO_MODE gated.
 */
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  GamesDedupAuditService,
  type DedupAuditResponse,
  type PersistSummary,
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

  @Post('dedup-audit/run')
  @HttpCode(200)
  runAndPersist(): Promise<PersistSummary> {
    return this.svc.persistSnapshot();
  }
}
