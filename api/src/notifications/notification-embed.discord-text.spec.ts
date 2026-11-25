import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import type { SettingsService } from '../settings/settings.service';
import { escapeHubName } from '../discord-bot/services/discord-embed-event-body.helpers';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { neutraliseMaskedLinks } from './notification-embed.discord-text';

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

/** Build a DM whose only user text sits in `payload`. */
async function buildWithPayload(
  type: NotificationType,
  payload: Record<string, unknown>,
) {
  const { embed } = await service().buildNotificationEmbed(
    { notificationId: 'n-2', type, title: 'Heads up', message: 'Hi', payload },
    'Raid Ledger',
  );
  return embed.toJSON();
}

describe('notification DM embed — payload text cannot render a masked link', () => {
  it('neutralises the event title in an embed FIELD value', async () => {
    const { fields } = await buildWithPayload('event_reminder', {
      eventTitle: EVIL_TITLE,
    });
    const event = fields?.find((f) => f.name === 'Event');
    expect(event?.value).toBe('\\[Free gold](https://evil.example)');
    for (const f of fields ?? []) expect(f.value).not.toMatch(LIVE_LINK);
  });

  it('neutralises the inviter and game names in the lfg_player_invite body', async () => {
    const { description } = await buildWithPayload('lfg_player_invite', {
      gameName: EVIL_TITLE,
      inviterName: '[Admin](https://evil.example)',
      reasons: [],
    });
    expect(description).not.toMatch(LIVE_LINK);
    expect(description).toContain('**\\[Free gold](https://evil.example)**');
    expect(description).toContain('\\[Admin](https://evil.example) thinks');
  });

  it('neutralises the game name in the subscribed_game body', async () => {
    const { description } = await buildWithPayload('subscribed_game', {
      gameName: EVIL_TITLE,
    });
    expect(description).toBe('🎮 **\\[Free gold](https://evil.example)**');
  });

  it('neutralises the lfg_invite game name but keeps the bot Join link live', async () => {
    const { description } = await buildWithPayload('lfg_invite', {
      gameName: EVIL_TITLE,
      memberCount: 3,
      url: 'https://raid.example/lfg/x',
    });
    expect(description).not.toMatch(LIVE_LINK);
    expect(description).toContain(
      '[Join the group](https://raid.example/lfg/x)',
    );
    expect(description).not.toContain('\\[Join the group]');
  });
});

describe('neutraliseMaskedLinks', () => {
  it('adds no second backslash to a name escapeHubName already escaped (ROK-1896)', () => {
    const escaped = escapeHubName(EVIL_TITLE);
    expect(escaped).toContain('\\[');
    expect(neutraliseMaskedLinks(escaped)).toBe(escaped);
  });

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
