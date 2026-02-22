import { Test, TestingModule } from '@nestjs/testing';
import { OgMetaService } from './og-meta.service';
import { InviteService } from './invite.service';
import { SettingsService } from '../settings/settings.service';

describe('OgMetaService', () => {
  let service: OgMetaService;
  let inviteService: { resolveInvite: jest.Mock };
  let settingsService: { getClientUrl: jest.Mock };

  beforeEach(async () => {
    inviteService = {
      resolveInvite: jest.fn(),
    };
    settingsService = {
      getClientUrl: jest.fn().mockResolvedValue('https://raid.example.com'),
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

  it('should be defined', () => {
    expect(service).toBeDefined();
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
});
