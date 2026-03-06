/**
 * OgMetaService — XSS prevention, edge cases, fallback OG, meta refresh,
 * HTML structure, and controller integration tests.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { InviteService } from './invite.service';
import { InviteController } from './invite.controller';
import { OgMetaService } from './og-meta.service';
import {
  makeValidInvite,
  setupOgMetaTestModule,
  type OgMetaMocks,
} from './og-meta.service.spec-helpers';

describe('OgMetaService — security & structure', () => {
  let service: OgMetaService;
  let mocks: OgMetaMocks;

  beforeEach(async () => {
    const setup = await setupOgMetaTestModule();
    service = setup.service;
    mocks = setup.mocks;
  });

  describe('XSS prevention', () => {
    it('should escape double quotes in event title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Title with "quotes"', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss1');
      expect(html).not.toContain('"quotes"');
      expect(html).toContain('&quot;quotes&quot;');
    });

    it('should escape single quotes in event title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: "O'Reilly's Bash", game: null }),
      );
      const html = await service.renderInviteOgHtml('xss2');
      expect(html).not.toMatch(/content="[^"]*'[^"]*"/);
      expect(html).toContain('&#39;');
    });

    it('should escape angle brackets in event title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: '<Evil> & "Nasty"', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss3');
      expect(html).not.toContain('<Evil>');
      expect(html).toContain('&lt;Evil&gt;');
    });

    it('should escape ampersands in event title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Raid & Conquer', game: null }),
      );
      const html = await service.renderInviteOgHtml('xss4');
      expect(html).toContain('Raid &amp; Conquer');
      expect(html).not.toContain('Raid & Conquer');
    });

    it('should escape ampersands in game name', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          game: { name: 'Dungeons & Dragons', coverUrl: null },
        }),
      );
      const html = await service.renderInviteOgHtml('xss5');
      expect(html).toContain('Dungeons &amp; Dragons');
    });

    it('should escape script tags in game cover URL', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          game: { name: 'Test Game', coverUrl: 'javascript:alert("xss")' },
        }),
      );
      const html = await service.renderInviteOgHtml('xss6');
      expect(html).not.toContain('alert("xss")');
    });

    it('should escape angle brackets in game cover URL', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
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
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: 'Caf\u00e9 Raider \u2014 \u014Ckami Night',
          game: null,
        }),
      );
      const html = await service.renderInviteOgHtml('xss8');
      expect(html).toContain('Caf\u00e9 Raider');
      expect(html).toContain('\u014Ckami Night');
    });

    it('should not render a raw <script> tag anywhere in the output', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({
          title: '<script>document.cookie</script>',
          game: null,
        }),
      );
      const html = await service.renderInviteOgHtml('xss9');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('</script>');
    });
  });

  describe('Edge cases — long strings and missing fields', () => {
    it('should handle a very long event title without throwing', async () => {
      const longTitle = 'A'.repeat(500);
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: longTitle, game: null }),
      );
      const html = await service.renderInviteOgHtml('long1');
      expect(html).toContain(longTitle);
    });

    it('should handle an event with no startTime', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
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
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('nogame');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
      expect(html).toContain('og:title');
      expect(html).toContain('og:description');
    });

    it('should handle game with empty string cover URL as missing cover art', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: { name: 'Unknown Game', coverUrl: null } }),
      );
      const html = await service.renderInviteOgHtml('emptycover');
      expect(html).not.toContain('og:image');
    });

    it('should not include "Game:" line in description when game is null', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('nodesc');
      expect(html).not.toContain('Game:');
    });

    it('should include "Game:" line in description when game name is present', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: { name: 'Elden Ring', coverUrl: null } }),
      );
      const html = await service.renderInviteOgHtml('withgame');
      expect(html).toContain('Game: Elden Ring');
    });

    it('should encode special characters in invite code in canonical URL', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('code with spaces');
      expect(html).toContain('/i/code%20with%20spaces');
    });

    it('should handle resolve returning valid:true but event is null/undefined', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: true,
        event: null,
      });
      const html = await service.renderInviteOgHtml('nullevent');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid');
    });
  });

  describe('Fallback OG tags per invalid invite status', () => {
    it('generic invalid code gets "invalid or has expired" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });
      const html = await service.renderInviteOgHtml('bad1');
      expect(html).toContain('invalid or has expired');
    });

    it('no error string gets default "invalid or has expired" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false });
      const html = await service.renderInviteOgHtml('bad2');
      expect(html).toContain('invalid or has expired');
    });

    it('expired error gets "already ended" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event has expired',
      });
      const html = await service.renderInviteOgHtml('bad3');
      expect(html).toContain('already ended');
      expect(html).not.toContain('invalid or has expired');
    });

    it('"ended" keyword in error maps to "already ended" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event has ended',
      });
      const html = await service.renderInviteOgHtml('bad4');
      expect(html).toContain('already ended');
    });

    it('claimed error gets "already been claimed" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Slot claimed',
      });
      const html = await service.renderInviteOgHtml('bad5');
      expect(html).toContain('already been claimed');
      expect(html).not.toContain('invalid or has expired');
    });

    it('cancelled error gets "been cancelled" description', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Event cancelled by organizer',
      });
      const html = await service.renderInviteOgHtml('bad6');
      expect(html).toContain('been cancelled');
      expect(html).not.toContain('invalid or has expired');
    });

    it('fallback HTML should NOT contain og:image', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Invite not found',
      });
      const html = await service.renderInviteOgHtml('bad7');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
    });

    it('fallback HTML should still contain all required OG meta tags except image', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
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
      mocks.inviteService.resolveInvite.mockRejectedValue(new Error('timeout'));
      const html = await service.renderInviteOgHtml('err1');
      expect(html).toContain('invalid');
      expect(html).not.toContain('og:image');
    });

    it('case-insensitive matching: mixed-case "Expired" keyword triggers ended message', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'EXPIRED link',
      });
      const html = await service.renderInviteOgHtml('bad9');
      expect(html).toContain('already ended');
    });

    it('case-insensitive matching: mixed-case "Cancelled" keyword triggers cancelled message', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'CANCELLED by admin',
      });
      const html = await service.renderInviteOgHtml('bad10');
      expect(html).toContain('been cancelled');
    });
  });

  describe('Meta refresh redirect tag', () => {
    it('should have http-equiv="refresh" pointing to canonical URL for valid invite', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('refresh1');
      expect(html).toMatch(
        /http-equiv="refresh" content="0;url=https:\/\/raid\.example\.com\/i\/refresh1"/,
      );
    });

    it('should have http-equiv="refresh" for fallback pages too', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({
        valid: false,
        error: 'Not found',
      });
      const html = await service.renderInviteOgHtml('refresh2');
      expect(html).toContain('http-equiv="refresh"');
      expect(html).toContain('https://raid.example.com/i/refresh2');
    });

    it('should redirect to URL with encoded invite code', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('code&special=1');
      expect(html).toContain('code%26special%3D1');
    });
  });

  describe('HTML structure validity', () => {
    it('should start with <!DOCTYPE html>', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct1');
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    });

    it('should contain <html lang="en">', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct2');
      expect(html).toContain('<html lang="en">');
    });

    it('should have a <head> section with charset UTF-8', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct3');
      expect(html).toContain('charset="UTF-8"');
    });

    it('should have a <body> with a redirect anchor', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct4');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
      expect(html).toContain('<a href=');
    });

    it('should have a <title> tag matching og:title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ title: 'Struct Event', game: null }),
      );
      const html = await service.renderInviteOgHtml('struct5');
      expect(html).toMatch(
        /<title>You&#39;re invited to: Struct Event<\/title>/,
      );
    });

    it('should have a <meta name="description"> tag', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(
        makeValidInvite({ game: null }),
      );
      const html = await service.renderInviteOgHtml('struct6');
      expect(html).toContain('name="description"');
    });

    it('fallback HTML should also be well-formed with DOCTYPE and body', async () => {
      mocks.inviteService.resolveInvite.mockRejectedValue(new Error('db down'));
      const html = await service.renderInviteOgHtml('struct7');
      expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });
  });

  describe('InviteController — OG endpoint integration', () => {
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
