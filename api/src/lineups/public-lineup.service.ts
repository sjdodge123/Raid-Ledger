/**
 * Public lineup read service (ROK-1067).
 *
 * Backs the un-authed `GET /api/lineups/public/:slug` endpoint with a single
 * narrow SQL query. The response is intentionally minimal — title /
 * description / status / decision / communityName — so an accidental SQL
 * change cannot leak voter, nominee, or invitee data.
 *
 * `findBySlug` returns `null` for ALL THREE failure cases (missing row,
 * `public_share_enabled = false`, `visibility = 'private'`). The combined
 * SQL `WHERE` clause means callers see exactly one 404 branch and an
 * attacker probing the namespace cannot distinguish "this slug never
 * existed" from "this lineup is currently disabled" (architect finding #6).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PublicLineupResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';

/**
 * Banned fields for grep-driven review — see RISK R3 in the plan. The
 * public response MUST NEVER carry any of these keys, even if a future
 * refactor reuses a richer projection. The strict response schema fails
 * loudly if drift introduces an extra key, but the comment names them so
 * reviewers and static analysis can spot regressions in the SELECT list.
 *
 * BANNED: voters, votes, nominees, invitees, voterIds, inviteeUserIds,
 *         createdBy, id, entries, totalVoters, totalMembers, myVotes
 */

@Injectable()
export class PublicLineupService {
    constructor(
        @Inject(DrizzleAsyncProvider)
        private readonly db: PostgresJsDatabase<typeof schema>,
        private readonly settings: SettingsService,
    ) {}

    /**
     * Resolve a public-share slug. Returns `null` if the row is missing,
     * if the toggle is off, OR if the lineup's visibility is private —
     * the controller maps any null to a single 404 branch.
     */
    async findBySlug(slug: string): Promise<PublicLineupResponseDto | null> {
        const [lineup] = await this.db
            .select({
                id: schema.communityLineups.id,
                title: schema.communityLineups.title,
                description: schema.communityLineups.description,
                status: schema.communityLineups.status,
                decidedGameId: schema.communityLineups.decidedGameId,
            })
            .from(schema.communityLineups)
            .where(
                and(
                    eq(schema.communityLineups.publicSlug, slug),
                    eq(schema.communityLineups.publicShareEnabled, true),
                    eq(schema.communityLineups.visibility, 'public'),
                ),
            )
            .limit(1);

        if (!lineup) return null;

        const decision = await this.resolveDecision(
            lineup.status,
            lineup.decidedGameId,
        );
        const communityName = await this.resolveCommunityName();

        return {
            title: lineup.title,
            description: lineup.description ?? null,
            status: lineup.status,
            decision,
            communityName,
        };
    }

    /**
     * Look up the decided game's name + cover URL. Returns null when the
     * lineup hasn't decided yet OR the game row was deleted out from under
     * a decided lineup (defensive — not expected in normal flow).
     */
    private async resolveDecision(
        status: string,
        decidedGameId: number | null,
    ): Promise<{ gameName: string; coverUrl: string | null } | null> {
        if (status !== 'decided' || !decidedGameId) return null;
        const [game] = await this.db
            .select({
                name: schema.games.name,
                coverUrl: schema.games.coverUrl,
            })
            .from(schema.games)
            .where(eq(schema.games.id, decidedGameId))
            .limit(1);
        if (!game) return null;
        return {
            gameName: game.name,
            coverUrl: game.coverUrl ?? null,
        };
    }

    /** Resolve the community display name; falls back to "Raid Ledger". */
    private async resolveCommunityName(): Promise<string> {
        const name = await this.settings.getDiscordBotCommunityName();
        return name && name.trim() !== '' ? name : 'Raid Ledger';
    }
}
