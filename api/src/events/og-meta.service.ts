import { Injectable, Logger } from '@nestjs/common';
import { InviteService } from './invite.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Renders minimal HTML pages with Open Graph meta tags for social media
 * crawlers requesting invite links (ROK-393).
 */
@Injectable()
export class OgMetaService {
  private readonly logger = new Logger(OgMetaService.name);

  constructor(
    private readonly inviteService: InviteService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Render an HTML page with OG meta tags for the given invite code.
   * Called by nginx when a crawler user agent requests /i/:code.
   */
  async renderInviteOgHtml(code: string): Promise<string> {
    const clientUrl =
      (await this.settingsService.getClientUrl()) ?? 'http://localhost:5173';
    const canonicalUrl = `${clientUrl}/i/${encodeURIComponent(code)}`;

    let resolveData;
    try {
      resolveData = await this.inviteService.resolveInvite(code);
    } catch (err) {
      this.logger.warn(
        'Failed to resolve invite for OG tags: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
      return this.renderFallbackHtml(
        'Raid Ledger',
        'This invite link is invalid.',
        canonicalUrl,
      );
    }

    if (!resolveData.valid) {
      const description = this.getFallbackDescription(resolveData.error);
      return this.renderFallbackHtml('Raid Ledger', description, canonicalUrl);
    }

    const event = resolveData.event;
    if (!event) {
      return this.renderFallbackHtml(
        'Raid Ledger',
        'This invite link is invalid.',
        canonicalUrl,
      );
    }

    const title = `You're invited to: ${event.title}`;
    const description = this.buildDescription(event);
    const imageUrl = event.game?.coverUrl ?? null;

    return this.renderHtml({
      title,
      description,
      url: canonicalUrl,
      imageUrl,
    });
  }

  private buildDescription(event: {
    title: string;
    startTime?: string;
    endTime?: string;
    game?: { name: string; coverUrl?: string | null } | null;
  }): string {
    const lines: string[] = [];
    lines.push(`You're invited to join ${event.title}!`);
    lines.push('');

    if (event.startTime) {
      const date = new Date(event.startTime);
      const dayStr = date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      lines.push(`${dayStr} at ${timeStr}`);
    }

    if (event.game?.name) {
      lines.push(`Game: ${event.game.name}`);
    }

    lines.push('');
    lines.push(
      'Click to sign up through Raid Ledger \u2014 log in with Discord or create an account to claim your spot.',
    );

    return lines.join('\n');
  }

  private getFallbackDescription(error?: string): string {
    if (!error) return 'This invite link is invalid or has expired.';
    if (
      error.toLowerCase().includes('expired') ||
      error.toLowerCase().includes('ended')
    ) {
      return 'This event has already ended.';
    }
    if (error.toLowerCase().includes('claimed')) {
      return 'This invite has already been claimed.';
    }
    if (error.toLowerCase().includes('cancelled')) {
      return 'This event has been cancelled.';
    }
    return 'This invite link is invalid or has expired.';
  }

  private renderHtml(meta: {
    title: string;
    description: string;
    url: string;
    imageUrl: string | null;
  }): string {
    const t = escapeHtml(meta.title);
    const d = escapeHtml(meta.description);
    const u = escapeHtml(meta.url);
    const imageTag = meta.imageUrl
      ? `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />\n    <meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}" />`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Raid Ledger" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    ${imageTag}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />

    <!-- Redirect real browsers to the SPA -->
    <meta http-equiv="refresh" content="0;url=${u}" />
  </head>
  <body>
    <p>Redirecting to <a href="${u}">${t}</a>...</p>
  </body>
</html>`;
  }

  private renderFallbackHtml(
    title: string,
    description: string,
    url: string,
  ): string {
    return this.renderHtml({
      title,
      description,
      url,
      imageUrl: null,
    });
  }
}

/** Escape HTML special characters to prevent XSS in rendered meta tags. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
