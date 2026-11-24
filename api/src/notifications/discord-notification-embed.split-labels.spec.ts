/**
 * ROK-2311 review R1 — the three split-out types carry their own label in the
 * DM footer and the batch summary, matching the settings row the Adjust link
 * opens. A poll DM that still said "Community Lineup" sent the member to turn
 * off a row that no longer governs it.
 */
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import type { SettingsService } from '../settings/settings.service';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { getTypeLabel } from './notification-embed.helpers';

const SPLIT_LABELS: [NotificationType, string][] = [
  ['scheduling_poll', 'Scheduling Poll'],
  ['lineup_lfg_offer', 'LFG Offer'],
  ['voice_access_lost', 'Voice Access Removed'],
];

function makeService(): DiscordNotificationEmbedService {
  const settings = {
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
  };
  return new DiscordNotificationEmbedService(
    settings as unknown as SettingsService,
  );
}

describe('split-type labels (ROK-2311 R1)', () => {
  beforeEach(() => {
    delete process.env.CLIENT_URL;
  });

  it.each(SPLIT_LABELS)('getTypeLabel(%s) is "%s"', (type, label) => {
    expect(getTypeLabel(type)).toBe(label);
  });

  it('the rows they left keep their own labels', () => {
    expect(getTypeLabel('community_lineup')).toBe('Community Lineup');
    expect(getTypeLabel('slot_vacated')).toBe('Slot Vacated');
  });

  it.each(SPLIT_LABELS)('%s DM footer reads "%s"', async (type, label) => {
    const { embed } = await makeService().buildNotificationEmbed(
      { notificationId: 'n-1', type, title: 'T', message: 'M' },
      'My Guild',
    );
    const json = embed.toJSON() as { footer?: { text: string } };
    expect(json.footer?.text).toBe(`My Guild · ${label}`);
  });

  it.each(SPLIT_LABELS)('%s batch summary names "%s"', async (type, label) => {
    const { embed } = await makeService().buildBatchSummaryEmbed(
      type,
      4,
      'Community',
    );
    const json = embed.toJSON() as { title?: string; description?: string };
    expect(json.title).toContain(`4 ${label} Notifications`);
    expect(json.description).toBe(
      `You have 4 new ${label.toLowerCase()} notifications. Check the web app for details.`,
    );
  });
});
