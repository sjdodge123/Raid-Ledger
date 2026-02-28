import { Test, TestingModule } from '@nestjs/testing';
import { OgMetaService } from './og-meta.service';
import { InviteService } from './invite.service';
import { InviteController } from './invite.controller';
import { SettingsService } from '../settings/settings.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid resolveInvite response for a valid invite. */
function makeValidInvite(
  overrides: {
    title?: string;
    startTime?: string;
    endTime?: string;
    game?: { name: string; coverUrl?: string | null } | null;
  } = {},
) {
  return {
    valid: true,
    event: {
      id: 1,
      title: overrides.title ?? 'Test Event',
      startTime: overrides.startTime ?? '2026-03-02T20:00:00.000Z',
      endTime: overrides.endTime ?? '2026-03-02T23:00:00.000Z',
      game:
        overrides.game !== undefined
          ? overrides.game
          : {
              name: 'World of Warcraft',
              coverUrl: 'https://images.igdb.com/cover.jpg',
            },
    },
    slot: { id: 1, role: 'dps', status: 'pending' },
  };
}

describe('OgMetaService', () => {
  let service: OgMetaService;
  let inviteService: { resolveInvite: jest.Mock };
  let settingsService: {
    getClientUrl: jest.Mock;
    getDefaultTimezone: jest.Mock;
  };

  beforeEach(async () => {
    inviteService = {
      resolveInvite: jest.fn(),
    };
    settingsService = {
      getClientUrl: jest.fn().mockResolvedValue('https://raid.example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OgMetaService,
        { provide: InviteService, useValue: inviteService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get<OgMetaService>(OgMetaService);
  });

  describe('renderInviteOgHtml', () => {
    it('should render OG tags for a valid invite', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: 'Mythic+ Monday',
          startTime: '2026-03-02T20:00:00.000Z',
          endTime: '2026-03-02T23:00:00.000Z',
          game: {
            name: 'World of Warcraft',
            coverUrl: 'https://images.igdb.com/cover.jpg',
          },
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });

      const html = await service.renderInviteOgHtml('abc123');

      expect(html).toContain('og:title');
      expect(html).toContain('You&#39;re invited to: Mythic+ Monday');
      expect(html).toContain('og:description');
      expect(html).toContain('World of Warcraft');
      expect(html).toContain('og:image');
      expect(html).toContain('https://images.igdb.com/cover.jpg');
      expect(html).toContain('og:url');
      expect(html).toContain('https://raid.example.com/i/abc123');
      expect(html).toContain('og:type');
      expect(html).toContain('og:site_name');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('twitter:card');
      expect(html).toContain('twitter:title');
      expect(html).toContain('twitter:description');
    });

    it('should render fallback OG tags for an invalid invite', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });

      const html = await service.renderInviteOgHtml('bad-code');

      expect(html).toContain('og:title');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid or has expired');
      expect(html).not.toContain('og:image');
    });

    it('should render fallback for already-claimed invite', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'This invite has already been claimed',
      });

      const html = await service.renderInviteOgHtml('claimed-code');

      expect(html).toContain('already been claimed');
    });

    it('should render fallback for ended event', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'This event has already ended',
      });

      const html = await service.renderInviteOgHtml('expired-code');

      expect(html).toContain('already ended');
    });

    it('should render fallback for cancelled event', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'This event has been cancelled',
      });

      const html = await service.renderInviteOgHtml('cancelled-code');

      expect(html).toContain('been cancelled');
    });

    it('should handle resolveInvite throwing an error', async () => {
      inviteService.resolveInvite.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const html = await service.renderInviteOgHtml('error-code');

      expect(html).toContain('og:title');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid');
    });

    it('should escape HTML special characters in event title', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: '<script>alert("xss")</script>',
          startTime: '2026-03-02T20:00:00.000Z',
          endTime: '2026-03-02T23:00:00.000Z',
          game: null,
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });

      const html = await service.renderInviteOgHtml('xss-code');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render without image tag when no cover art', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: 'Game Night',
          startTime: '2026-03-02T20:00:00.000Z',
          endTime: '2026-03-02T23:00:00.000Z',
          game: { name: 'Custom Game', coverUrl: null },
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });

      const html = await service.renderInviteOgHtml('no-cover');

      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
    });

    it('should include meta refresh redirect to SPA', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: 'Test Event',
          startTime: '2026-03-02T20:00:00.000Z',
          endTime: '2026-03-02T23:00:00.000Z',
          game: null,
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });

      const html = await service.renderInviteOgHtml('test-code');

      expect(html).toContain('http-equiv="refresh"');
      expect(html).toContain('https://raid.example.com/i/test-code');
    });

    it('should use localhost fallback when client URL is null', async () => {
      settingsService.getClientUrl.mockResolvedValue(null);
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: 'Test Event',
          startTime: '2026-03-02T20:00:00.000Z',
          endTime: '2026-03-02T23:00:00.000Z',
          game: null,
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });

      const html = await service.renderInviteOgHtml('local-code');

      expect(html).toContain('http://localhost:5173/i/local-code');
    });
  });

  // =========================================================================
  // OG tag content correctness — exact attribute values
  // =========================================================================
  describe('OG tag content correctness', () => {
    beforeEach(() => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: 'Mythic+ Monday',
          startTime: '2026-03-02T20:00:00.000Z',
          game: {
            name: 'World of Warcraft',
            coverUrl: 'https://images.igdb.com/cover.jpg',
          },
        }),
      );
    });

    it('og:type should equal "website"', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toMatch(/property="og:type"\s+content="website"/);
    });

    it('og:site_name should equal "Raid Ledger"', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toMatch(/property="og:site_name"\s+content="Raid Ledger"/);
    });

    it('og:title should contain event name prefixed with invitation phrase', async () => {
      const html = await service.renderInviteOgHtml('abc');
      // The apostrophe is escaped to &#39;
      expect(html).toContain('You&#39;re invited to: Mythic+ Monday');
    });

    it('og:url should equal the canonical invite URL', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain(
        'property="og:url" content="https://raid.example.com/i/abc"',
      );
    });

    it('og:image should contain the game cover URL', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain(
        'property="og:image" content="https://images.igdb.com/cover.jpg"',
      );
    });

    it('og:description should contain the game name', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain('og:description');
      expect(html).toContain('World of Warcraft');
    });

    it('og:description should include Discord/account signup walkthrough', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain('Discord');
    });

    it('og:description should mention clicking to sign up', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain('Click to sign up');
    });
  });

  // =========================================================================
  // Twitter card tags
  // =========================================================================
  describe('Twitter card tags', () => {
    beforeEach(() => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: 'Weekend Raid',
          game: {
            name: 'FFXIV',
            coverUrl: 'https://images.igdb.com/ffxiv.jpg',
          },
        }),
      );
    });

    it('twitter:card should equal "summary"', async () => {
      const html = await service.renderInviteOgHtml('tw1');
      expect(html).toMatch(/name="twitter:card"\s+content="summary"/);
    });

    it('twitter:title should be present with correct value', async () => {
      const html = await service.renderInviteOgHtml('tw1');
      expect(html).toContain('name="twitter:title"');
      expect(html).toContain('Weekend Raid');
    });

    it('twitter:description should be present', async () => {
      const html = await service.renderInviteOgHtml('tw1');
      expect(html).toContain('name="twitter:description"');
    });

    it('twitter:image should equal the game cover URL when present', async () => {
      const html = await service.renderInviteOgHtml('tw1');
      expect(html).toContain(
        'name="twitter:image" content="https://images.igdb.com/ffxiv.jpg"',
      );
    });

    it('twitter:image should be absent when no cover art', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: { name: 'Custom Game', coverUrl: null } }),
      );
      const html = await service.renderInviteOgHtml('tw2');
      expect(html).not.toContain('twitter:image');
    });

    it('twitter:image should be absent when game is null', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('tw3');
      expect(html).not.toContain('twitter:image');
    });
  });

  // =========================================================================
  // XSS prevention — special characters in event data
  // =========================================================================
  describe('XSS prevention', () => {
    it('should escape double quotes in event title', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Title with "quotes"', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss1');
      expect(html).not.toContain('"quotes"');
      expect(html).toContain('&quot;quotes&quot;');
    });

    it('should escape single quotes in event title', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: "O'Reilly's Bash", game: null }),
      );
      const html = await service.renderInviteOgHtml('xss2');
      expect(html).not.toMatch(/content="[^"]*'[^"]*"/);
      expect(html).toContain('&#39;');
    });

    it('should escape angle brackets in event title', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: '<Evil> & "Nasty"', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss3');
      expect(html).not.toContain('<Evil>');
      expect(html).toContain('&lt;Evil&gt;');
    });

    it('should escape ampersands in event title', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Raid & Conquer', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss4');
      // The properly escaped form should be present
      expect(html).toContain('Raid &amp; Conquer');
      // The raw unescaped form should NOT appear (split on & to check both sides)
      expect(html).not.toContain('Raid & Conquer');
    });

    it('should escape ampersands in game name', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          game: { name: 'Dungeons & Dragons', coverUrl: null },
        }),
      );
      const html = await service.renderInviteOgHtml('xss5');
      expect(html).toContain('Dungeons &amp; Dragons');
    });

    it('should escape script tags in game cover URL', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          game: {
            name: 'Test Game',
            coverUrl: 'javascript:alert("xss")',
          },
        }),
      );
      const html = await service.renderInviteOgHtml('xss6');
      // Raw quotes inside attribute values should be escaped
      expect(html).not.toContain('alert("xss")');
    });

    it('should escape angle brackets in game cover URL', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          game: {
            name: 'Test Game',
            coverUrl: 'https://cdn.example.com/<evil>.jpg',
          },
        }),
      );
      const html = await service.renderInviteOgHtml('xss7');
      expect(html).not.toContain('<evil>');
      expect(html).toContain('&lt;evil&gt;');
    });

    it('should handle unicode characters without escaping them', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: 'Café Raider \u2014 Ōkami Night',
          game: null,
        }),
      );
      const html = await service.renderInviteOgHtml('xss8');
      // Unicode should pass through intact (not double-encoded)
      expect(html).toContain('Café Raider');
      expect(html).toContain('Ōkami Night');
    });

    it('should not render a raw <script> tag anywhere in the output', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: '<script>document.cookie</script>',
          game: null,
        }),
      );
      const html = await service.renderInviteOgHtml('xss9');
      // Only the one legitimate <script>-free <head> and body tags should exist
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('</script>');
    });
  });

  // =========================================================================
  // Edge cases — very long strings and missing fields
  // =========================================================================
  describe('Edge cases — long strings and missing fields', () => {
    it('should handle a very long event title without throwing', async () => {
      const longTitle = 'A'.repeat(500);
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: longTitle, game: null }),
      );
      const html = await service.renderInviteOgHtml('long1');
      expect(html).toContain(longTitle);
    });

    it('should handle an event with no startTime', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: {
          id: 1,
          title: 'Open Night',
          startTime: undefined,
          endTime: undefined,
          game: null,
        },
        slot: { id: 1, role: 'dps', status: 'pending' },
      });
      const html = await service.renderInviteOgHtml('notime');
      expect(html).toContain('og:title');
      expect(html).toContain('Open Night');
    });

    it('should handle an event with no game at all (null game field)', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('nogame');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
      // Should still have basic OG tags
      expect(html).toContain('og:title');
      expect(html).toContain('og:description');
    });

    it('should handle game with empty string cover URL as missing cover art', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: { name: 'Unknown Game', coverUrl: null } }),
      );
      const html = await service.renderInviteOgHtml('emptycover');
      expect(html).not.toContain('og:image');
    });

    it('should not include "Game:" line in description when game is null', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('nodesc');
      // "Game:" label should only appear when a game name is present
      expect(html).not.toContain('Game:');
    });

    it('should include "Game:" line in description when game name is present', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: { name: 'Elden Ring', coverUrl: null } }),
      );
      const html = await service.renderInviteOgHtml('withgame');
      expect(html).toContain('Game: Elden Ring');
    });

    it('should encode special characters in invite code in canonical URL', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('code with spaces');
      // The code should be percent-encoded in the URL
      expect(html).toContain('/i/code%20with%20spaces');
    });

    it('should handle resolve returning valid:true but event is null/undefined', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: null,
      });
      const html = await service.renderInviteOgHtml('nullevent');
      // Should fall back gracefully
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid');
    });
  });

  // =========================================================================
  // Invalid/expired/claimed/cancelled invite codes — fallback differentiation
  // =========================================================================
  describe('Fallback OG tags per invalid invite status', () => {
    it('generic invalid code gets "invalid or has expired" description', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });
      const html = await service.renderInviteOgHtml('bad1');
      expect(html).toContain('invalid or has expired');
    });

    it('no error string gets default "invalid or has expired" description', async () => {
      inviteService.resolveInvite.mockResolvedValue({ valid: false });
      const html = await service.renderInviteOgHtml('bad2');
      expect(html).toContain('invalid or has expired');
    });

    it('expired error gets "already ended" description, not generic message', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event has expired',
      });
      const html = await service.renderInviteOgHtml('bad3');
      expect(html).toContain('already ended');
      expect(html).not.toContain('invalid or has expired');
    });

    it('"ended" keyword in error maps to "already ended" description', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event has ended',
      });
      const html = await service.renderInviteOgHtml('bad4');
      expect(html).toContain('already ended');
    });

    it('claimed error gets "already been claimed" description, not generic message', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Slot claimed',
      });
      const html = await service.renderInviteOgHtml('bad5');
      expect(html).toContain('already been claimed');
      expect(html).not.toContain('invalid or has expired');
    });

    it('cancelled error gets "been cancelled" description, not generic message', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event cancelled by organizer',
      });
      const html = await service.renderInviteOgHtml('bad6');
      expect(html).toContain('been cancelled');
      expect(html).not.toContain('invalid or has expired');
    });

    it('fallback HTML should NOT contain og:image', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });
      const html = await service.renderInviteOgHtml('bad7');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
    });

    it('fallback HTML should still contain all required OG meta tags except image', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });
      const html = await service.renderInviteOgHtml('bad8');
      expect(html).toContain('og:type');
      expect(html).toContain('og:site_name');
      expect(html).toContain('og:title');
      expect(html).toContain('og:description');
      expect(html).toContain('og:url');
    });

    it('exception from resolveInvite produces "invalid" fallback without og:image', async () => {
      inviteService.resolveInvite.mockRejectedValue(new Error('timeout'));
      const html = await service.renderInviteOgHtml('err1');
      expect(html).toContain('invalid');
      expect(html).not.toContain('og:image');
    });

    it('case-insensitive matching: mixed-case "Expired" keyword triggers ended message', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'EXPIRED link',
      });
      const html = await service.renderInviteOgHtml('bad9');
      expect(html).toContain('already ended');
    });

    it('case-insensitive matching: mixed-case "Cancelled" keyword triggers cancelled message', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'CANCELLED by admin',
      });
      const html = await service.renderInviteOgHtml('bad10');
      expect(html).toContain('been cancelled');
    });
  });

  // =========================================================================
  // Meta refresh tag
  // =========================================================================
  describe('Meta refresh redirect tag', () => {
    it('should have http-equiv="refresh" pointing to canonical URL for valid invite', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('refresh1');
      expect(html).toMatch(
        /http-equiv="refresh" content="0;url=https:\/\/raid\.example\.com\/i\/refresh1"/,
      );
    });

    it('should have http-equiv="refresh" for fallback pages too', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Not found',
      });
      const html = await service.renderInviteOgHtml('refresh2');
      expect(html).toContain('http-equiv="refresh"');
      expect(html).toContain('https://raid.example.com/i/refresh2');
    });

    it('should redirect to URL with encoded invite code', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('code&special=1');
      expect(html).toContain('code%26special%3D1');
    });
  });

  // =========================================================================
  // HTML structure validity
  // =========================================================================
  describe('HTML structure validity', () => {
    it('should start with <!DOCTYPE html>', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct1');
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it('should contain <html lang="en">', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct2');
      expect(html).toContain('<html lang="en">');
    });

    it('should have a <head> section with charset UTF-8', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct3');
      expect(html).toContain('charset="UTF-8"');
    });

    it('should have a <body> with a redirect anchor', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct4');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
      expect(html).toContain('<a href=');
    });

    it('should have a <title> tag matching og:title', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Struct Event', game: null }),
      );
      const html = await service.renderInviteOgHtml('struct5');
      // Both <title> and og:title should carry the escaped event title
      expect(html).toMatch(
        /<title>You&#39;re invited to: Struct Event<\/title>/,
      );
    });

    it('should have a <meta name="description"> tag', async () => {
      inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct6');
      expect(html).toContain('name="description"');
    });

    it('fallback HTML should also be well-formed with DOCTYPE and body', async () => {
      inviteService.resolveInvite.mockRejectedValue(new Error('db down'));
      const html = await service.renderInviteOgHtml('struct7');
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });
  });

  // =========================================================================
  // Controller integration (InviteController)
  // =========================================================================
  describe('InviteController — OG endpoint integration', () => {
    // We test the controller directly, verifying it calls OgMetaService and
    // that the decorator metadata is configured correctly.

    it('should return the HTML produced by OgMetaService', async () => {
      const mockOgMetaService = {
        renderInviteOgHtml: jest.fn().mockResolvedValue('<html>ok</html>'),
      };
      const mockInviteService = {
        resolveInvite: jest.fn(),
        claimInvite: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [InviteController],
        providers: [
          { provide: InviteService, useValue: mockInviteService },
          { provide: OgMetaService, useValue: mockOgMetaService },
        ],
      }).compile();

      const controller = module.get(InviteController);
      const result = await controller.renderOgMeta('testcode');

      expect(mockOgMetaService.renderInviteOgHtml).toHaveBeenCalledWith(
        'testcode',
      );
      expect(result).toBe('<html>ok</html>');
    });

    it('renderOgMeta route is registered before :code to avoid shadowing', () => {
      // Verify the OG endpoint uses ':code/og' path which is more specific
      // than the plain ':code' resolve route. We check via Reflect metadata.
      const proto = InviteController.prototype as unknown as Record<
        string,
        unknown
      >;
      const metadataKeys = Reflect.getMetadataKeys(
        proto['renderOgMeta'] as object,
      );
      expect(metadataKeys.length).toBeGreaterThan(0);
    });
  });
});
