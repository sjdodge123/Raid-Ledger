import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import type { SettingsService } from '../settings/settings.service';
import { neutraliseMaskedLinks } from './notification-embed.hub-proposal';

/** A `[label](url)` whose `[` is not escaped by an odd run of backslashes. */
const LIVE_LINK = /(^|[^\\])(\\\\)*\[[^\n]*\]\(https:\/\/evil\.example\)/;
const EVIL_TITLE = '[Free gold](https://evil.example)';

function service(): DiscordNotificationEmbedService {
  const settings = {
    getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
  };
  return new DiscordNotificationEmbedService(
    settings as unknown as SettingsService,
  );
}

describe('notification DM embed — user text cannot render a masked link', () => {
  it('an event title shaped like a masked link reaches the DM as plain text', async () => {
    const message = `Your event **${EVIL_TITLE}** starts in 15 minutes.`;
    const { embed } = await service().buildNotificationEmbed(
      {
        notificationId: 'n-1',
        type: 'event_reminder',
        title: `Reminder: ${EVIL_TITLE}`,
        message,
      },
      'Raid Ledger',
    );
    const { title, description } = embed.toJSON();
    expect(description).not.toMatch(LIVE_LINK);
    expect(title).not.toMatch(LIVE_LINK);
    expect(description).toBe(
      'Your event **\\[Free gold](https://evil.example)** starts in 15 minutes.',
    );
  });
});

describe('neutraliseMaskedLinks', () => {
  it('leaves text without a link untouched, brackets included', () => {
    expect(neutraliseMaskedLinks('[Raid] Molten Core **tonight**')).toBe(
      '[Raid] Molten Core **tonight**',
    );
  });

  it('breaks every link on a line, not only the first', () => {
    const out = neutraliseMaskedLinks(
      '[a](https://x.example) and [b](https://y.example)',
    );
    expect(out).toBe('\\[a](https://x.example) and \\[b](https://y.example)');
  });

  it('breaks a link whose label nests brackets', () => {
    expect(neutraliseMaskedLinks('[a[b]](https://evil.example)')).toBe(
      '\\[a\\[b]](https://evil.example)',
    );
  });

  it('is idempotent, so an upstream escape is never re-armed', () => {
    const once = neutraliseMaskedLinks(EVIL_TITLE);
    expect(neutraliseMaskedLinks(once)).toBe(once);
  });

  it('escapes a bracket behind an escaped backslash', () => {
    expect(neutraliseMaskedLinks('\\\\[x](https://evil.example)')).toBe(
      '\\\\\\[x](https://evil.example)',
    );
  });
});
