/**
 * Public lineup controller (ROK-1067) — INTENTIONALLY UNGUARDED.
 *
 * Backs `GET /api/lineups/public/:slug` (JSON for the SPA) and
 * `GET /api/lineups/public/:slug/og` (HTML for crawlers, reached via
 * the nginx crawler-rewrite of `/p/lineup/:slug`).
 *
 * Auth bypass is intentional and locked in by an integration test that
 * issues a request with no `Authorization` header and asserts 200. If a
 * future PR globalizes the JWT guard, that test fails loudly so we don't
 * silently break public sharing. See architect finding #5.
 *
 * Output goes through `PublicLineupResponseSchema.strict().parse()` in
 * the JSON path, so any field-leak regression in the service projection
 * surfaces at runtime — never via wire.
 */
import {
    BadRequestException,
    Controller,
    Get,
    Header,
    NotFoundException,
    Param,
} from '@nestjs/common';
import {
    PublicLineupParamsSchema,
    PublicLineupResponseSchema,
    type PublicLineupResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { PublicLineupService } from './public-lineup.service';
import { PublicLineupOgService } from './public-lineup-og.service';

@Controller('lineups/public')
@RateLimit('public')
export class PublicLineupController {
    constructor(
        private readonly publicLineup: PublicLineupService,
        private readonly og: PublicLineupOgService,
    ) {}

    /**
     * OG meta tag HTML for social-media crawlers.
     *
     * Reached via the nginx crawler-rewrite block (`/p/lineup/:slug` →
     * `/lineups/public/:slug/og` for `Discordbot`/`Twitterbot`/etc.). Real
     * browsers hit the SPA path and never reach this endpoint. Registered
     * BEFORE `:slug` to avoid route shadowing.
     */
    @Get(':slug/og')
    @Header('Content-Type', 'text/html; charset=utf-8')
    @Header('Cache-Control', 'public, max-age=300')
    async getOg(@Param('slug') slug: string): Promise<string> {
        // Don't 400 on garbage input — crawlers may probe odd URLs and we
        // prefer to render a generic preview rather than break the unfurl.
        return this.og.renderLineupOgHtml(slug);
    }

    /**
     * Public JSON view of a community lineup.
     * 404 covers all three failure cases (missing, disabled, private) via a
     * single SQL `WHERE` — no information leak.
     */
    @Get(':slug')
    async getPublicLineup(
        @Param('slug') rawSlug: string,
    ): Promise<PublicLineupResponseDto> {
        const params = PublicLineupParamsSchema.safeParse({ slug: rawSlug });
        if (!params.success) {
            throw new BadRequestException(params.error.flatten().fieldErrors);
        }
        const dto = await this.publicLineup.findBySlug(params.data.slug);
        if (!dto) throw new NotFoundException();
        // Strict parse — defends against field-leak regressions in the
        // service projection (architect finding #4).
        return PublicLineupResponseSchema.parse(dto);
    }
}
