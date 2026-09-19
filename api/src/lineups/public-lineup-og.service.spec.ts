/**
 * ROK-1627 — the public lineup OG page uses the configured client URL and
 * otherwise the origin of the request it is answering, never a localhost
 * default and never a stored origin from an earlier request.
 */
import { PublicLineupOgService } from './public-lineup-og.service';
import type { PublicLineupService } from './public-lineup.service';
import type { SettingsService } from '../settings/settings.service';

function makeService(trusted: string | null) {
  const settings = {
    getTrustedClientUrl: jest.fn().mockResolvedValue(trusted),
  };
  const publicLineup = { findBySlug: jest.fn().mockResolvedValue(null) };
  const service = new PublicLineupOgService(
    publicLineup as unknown as PublicLineupService,
    settings as unknown as SettingsService,
  );
  return { service, settings, publicLineup };
}

describe('PublicLineupOgService — canonical URL', () => {
  it('uses the configured client URL when one is available', async () => {
    const { service } = makeService('https://raid.example.com');
    const html = await service.renderLineupOgHtml(
      'friday',
      'https://crawler.example',
    );
    expect(html).toContain('https://raid.example.com/p/lineup/friday');
    expect(html).not.toContain('https://crawler.example');
  });

  it('falls back to the request origin, not localhost', async () => {
    const { service } = makeService(null);
    const html = await service.renderLineupOgHtml(
      'friday',
      'https://crawler.example',
    );
    expect(html).toContain('https://crawler.example/p/lineup/friday');
    expect(html).not.toContain('localhost');
  });

  it('never persists or reuses a request origin', async () => {
    const before = process.env.CLIENT_URL;
    const { service } = makeService(null);
    await service.renderLineupOgHtml('a', 'https://first.example');
    expect(process.env.CLIENT_URL).toBe(before);
    const html = await service.renderLineupOgHtml('b', 'https://second.example');
    expect(html).toContain('https://second.example/p/lineup/b');
    expect(html).not.toContain('https://first.example');
  });
});
