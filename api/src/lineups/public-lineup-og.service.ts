/**
 * Server-side OG meta tag renderer for public lineup links (ROK-1067).
 *
 * Mirrors the ROK-393 invite OG pattern (api/src/events/og-meta.service.ts)
 * — string-template HTML, no filesystem reads, fully self-contained page.
 * Real browsers bounce to the SPA route via a `<meta http-equiv="refresh">`;
 * crawlers stop at the head and consume the OG/Twitter meta tags.
 *
 * Twitter card type is `summary` (NOT `summary_large_image`) — IGDB game
 * covers are portrait orientation and downgrade automatically; explicit
 * `summary` avoids a card-shape mismatch (architect finding #6).
 *
 * Falls back to a generic Raid Ledger card on null lookup so crawlers
 * still get a usable preview AND the JSON 404 information-hiding policy
 * is preserved (we don't leak slug existence/disablement state).
 */
import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PublicLineupService } from './public-lineup.service';

@Injectable()
export class PublicLineupOgService {
    private readonly logger = new Logger(PublicLineupOgService.name);

    constructor(
        private readonly publicLineup: PublicLineupService,
        private readonly settings: SettingsService,
    ) {}

    /**
     * Render an OG-tagged HTML page for the given slug. Unknown / disabled /
     * private slugs return a generic Raid Ledger preview to avoid leaking
     * existence state to crawlers.
     */
    async renderLineupOgHtml(slug: string): Promise<string> {
        const clientUrl = await this.settings.getClientUrl();
        const canonicalUrl = `${clientUrl}/p/lineup/${encodeURIComponent(slug)}`;

        // Real backend failures still degrade to the generic preview so the
        // crawler unfurl never breaks, but they get logged distinctly so an
        // outage doesn't hide as a stream of "generic" cards.
        const dto = await this.publicLineup.findBySlug(slug).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : undefined;
            this.logger.error(
                `Public lineup OG lookup failed for slug=${slug}: ${message}`,
                stack,
            );
            return null;
        });
        if (!dto) {
            return buildOgHtmlPage({
                title: 'Raid Ledger',
                description:
                    'A community lineup link. Sign in to nominate, vote, or share your own.',
                url: canonicalUrl,
                imageUrl: null,
            });
        }

        const title = `${dto.title} — ${dto.communityName}`;
        const description = buildDescription(dto);
        const imageUrl = dto.decision?.coverUrl ?? null;
        return buildOgHtmlPage({ title, description, url: canonicalUrl, imageUrl });
    }
}

interface PublicLineupLike {
    title: string;
    description: string | null;
    status: 'building' | 'voting' | 'decided' | 'archived';
    decision: { gameName: string; coverUrl: string | null } | null;
    communityName: string;
}

const STATUS_COPY: Record<PublicLineupLike['status'], string> = {
    building: 'Nominations open — community lineup is forming.',
    voting: 'Voting is open — see what the community is choosing.',
    decided: 'A winner has been chosen!',
    archived: 'Lineup complete.',
};

function buildDescription(dto: PublicLineupLike): string {
    if (dto.description && dto.description.trim() !== '') {
        return dto.description.length > 200
            ? `${dto.description.slice(0, 197)}…`
            : dto.description;
    }
    if (dto.status === 'decided' && dto.decision) {
        return `Winner: ${dto.decision.gameName}. ${STATUS_COPY.decided}`;
    }
    return STATUS_COPY[dto.status];
}

interface OgMeta {
    title: string;
    description: string;
    url: string;
    imageUrl: string | null;
}

/** Escape HTML special characters to prevent injection in rendered tags. */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildOgHtmlPage(meta: OgMeta): string {
    const t = escapeHtml(meta.title);
    const d = escapeHtml(meta.description);
    const u = escapeHtml(meta.url);
    const headTags = buildOgHeadTags(t, d, u, meta.imageUrl);

    return `<!DOCTYPE html>
<html lang="en">
  <head>${headTags}
  </head>
  <body>
    <p>Redirecting to <a href="${u}">${t}</a>...</p>
  </body>
</html>`;
}

function buildOgHeadTags(
    t: string,
    d: string,
    u: string,
    imageUrl: string | null,
): string {
    const imageTag = imageUrl
        ? `\n    <meta property="og:image" content="${escapeHtml(imageUrl)}" />\n    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`
        : '';

    return `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <!-- Open Graph -->
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Raid Ledger" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    ${imageTag}
    <!-- Twitter Card (summary, not summary_large_image — IGDB covers are portrait) -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <!-- Redirect real browsers to the SPA -->
    <meta http-equiv="refresh" content="0;url=${u}" />`;
}
