/**
 * OgMetaService — renderInviteOgHtml, OG tag content, and Twitter card tests.
 */
import {
  makeValidInvite,
  setupOgMetaTestModule,
  type OgMetaMocks,
} from './og-meta.service.spec-helpers';
import type { OgMetaService } from './og-meta.service';

describe('OgMetaService — render & tags', () => {
  let service: OgMetaService;
  let mocks: OgMetaMocks;

  beforeEach(async () => {
    const setup = await setupOgMetaTestModule();
    service = setup.service;
    mocks = setup.mocks;
  });

  describe('renderInviteOgHtml', () => {
    it('should render OG tags for a valid invite', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ title: 'Mythic+ Monday', game: { name: 'World of Warcraft', coverUrl: 'https://images.igdb.com/cover.jpg' } }));
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
      mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false, error: 'Invite not found' });
      const html = await service.renderInviteOgHtml('bad-code');
      expect(html).toContain('og:title');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid or has expired');
      expect(html).not.toContain('og:image');
    });

    it('should render fallback for already-claimed invite', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false, error: 'This invite has already been claimed' });
      const html = await service.renderInviteOgHtml('claimed-code');
      expect(html).toContain('already been claimed');
    });

    it('should render fallback for ended event', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false, error: 'This event has already ended' });
      const html = await service.renderInviteOgHtml('expired-code');
      expect(html).toContain('already ended');
    });

    it('should render fallback for cancelled event', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false, error: 'This event has been cancelled' });
      const html = await service.renderInviteOgHtml('cancelled-code');
      expect(html).toContain('been cancelled');
    });

    it('should handle resolveInvite throwing an error', async () => {
      mocks.inviteService.resolveInvite.mockRejectedValue(new Error('Database connection failed'));
      const html = await service.renderInviteOgHtml('error-code');
      expect(html).toContain('og:title');
      expect(html).toContain('Raid Ledger');
      expect(html).toContain('invalid');
    });

    it('should escape HTML special characters in event title', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ title: '<script>alert("xss")</script>', game: null }));
      const html = await service.renderInviteOgHtml('xss-code');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render without image tag when no cover art', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ game: { name: 'Custom Game', coverUrl: null } }));
      const html = await service.renderInviteOgHtml('no-cover');
      expect(html).not.toContain('og:image');
      expect(html).not.toContain('twitter:image');
    });

    it('should include meta refresh redirect to SPA', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ game: null }));
      const html = await service.renderInviteOgHtml('test-code');
      expect(html).toContain('http-equiv="refresh"');
      expect(html).toContain('https://raid.example.com/i/test-code');
    });

    it('should use localhost fallback when client URL is null', async () => {
      mocks.settingsService.getClientUrl.mockResolvedValue(null);
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ game: null }));
      const html = await service.renderInviteOgHtml('local-code');
      expect(html).toContain('http://localhost:5173/i/local-code');
    });
  });

  describe('OG tag content correctness', () => {
    beforeEach(() => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ title: 'Mythic+ Monday', startTime: '2026-03-02T20:00:00.000Z', game: { name: 'World of Warcraft', coverUrl: 'https://images.igdb.com/cover.jpg' } }));
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
      expect(html).toContain('You&#39;re invited to: Mythic+ Monday');
    });

    it('og:url should equal the canonical invite URL', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain('property="og:url" content="https://raid.example.com/i/abc"');
    });

    it('og:image should contain the game cover URL', async () => {
      const html = await service.renderInviteOgHtml('abc');
      expect(html).toContain('property="og:image" content="https://images.igdb.com/cover.jpg"');
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

  describe('Twitter card tags', () => {
    beforeEach(() => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ title: 'Weekend Raid', game: { name: 'FFXIV', coverUrl: 'https://images.igdb.com/ffxiv.jpg' } }));
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
      expect(html).toContain('name="twitter:image" content="https://images.igdb.com/ffxiv.jpg"');
    });

    it('twitter:image should be absent when no cover art', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ game: { name: 'Custom Game', coverUrl: null } }));
      const html = await service.renderInviteOgHtml('tw2');
      expect(html).not.toContain('twitter:image');
    });

    it('twitter:image should be absent when game is null', async () => {
      mocks.inviteService.resolveInvite.mockResolvedValue(makeValidInvite({ game: null }));
      const html = await service.renderInviteOgHtml('tw3');
      expect(html).not.toContain('twitter:image');
    });
  });
});
