/**
 * ROK-2187 — the public GG summary behind `/w/:slug` — INTENTIONALLY
 * UNGUARDED (anonymous viewers). Returns the Summary card allow-list only
 * (Q4): no other players' names, no ids, no email. 404 once the owner turns
 * sharing off or rotates the slug, and for a deactivated owner.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { RateLimit } from '../../../throttler/rate-limit.decorator';
import { toGgPublicSummary } from './gg-dto.helpers';
import { findGgPublic } from './gg-snapshot.queries';

const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;

@Controller('gg/public')
@RateLimit('public')
export class GgPublicController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** `GET /gg/public/:slug` — the shared Summary only. */
  @Get(':slug')
  async read(@Param('slug') slug: string): Promise<GgPublicSummaryDto> {
    if (!SLUG_RE.test(slug)) throw new BadRequestException('Invalid slug');
    const row = await findGgPublic(this.db, slug);
    const dto = row ? toGgPublicSummary(row) : null;
    if (!dto) throw new NotFoundException('GG not found');
    return dto;
  }
}
