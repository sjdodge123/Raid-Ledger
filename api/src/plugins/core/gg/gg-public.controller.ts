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
  Header,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { getRequestOrigin } from '../../../common/request-origin.helpers';
import { RateLimit } from '../../../throttler/rate-limit.decorator';
import { toGgPublicSummary } from './gg-dto.helpers';
import { findGgPublic } from './gg-snapshot.queries';
import { GgShareCardService } from './share/gg-share-card.service';

const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;

@Controller('gg/public')
@RateLimit('public')
export class GgPublicController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly shareCard: GgShareCardService,
  ) {}

  /**
   * `GET /gg/public/:slug/card.png` — the 1200×630 share card (OG image).
   * Immutable per (slug, computed_at); 404 the moment sharing is revoked.
   */
  @Get(':slug/card.png')
  async card(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const card = await this.shareCard.png(slug);
    if (!card) throw new NotFoundException('GG not found');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', card.etag);
    if (req.headers['if-none-match'] === card.etag) {
      res.status(304);
      return undefined;
    }
    return new StreamableFile(card.png, { type: 'image/png' });
  }

  /** `GET /gg/public/:slug/og` — crawler HTML (reached via the nginx rewrite of `/w/:slug`). */
  @Get(':slug/og')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async og(@Param('slug') slug: string, @Req() req: Request): Promise<string> {
    return this.shareCard.ogHtml(slug, getRequestOrigin(req));
  }

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
