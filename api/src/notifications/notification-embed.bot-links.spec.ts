/**
 * Codex P2 follow-ups to the masked-link neutralising: the bot's OWN links
 * (lineup ballot, tiebreaker CTA) stay clickable because user values are
 * escaped at the source, and escaped text is fitted to Discord's limits.
 */
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import type { SettingsService } from '../settings/settings.service';
import type { NotificationService } from './notification.service';
import type { NotificationDedupService } from './notification-dedup.service';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { sendVotingDM } from '../lineups/lineup-notification-dm.helpers';
import { sendTiebreakerOpenDM } from '../lineups/lineup-notification-private-dm.helpers';
import { PostEventFollowupPromptService } from './post-event-followup-prompt.service';
import {
  DISCORD_LIMITS,
  fitDiscordText,
} from './notification-embed.discord-text';

/** A `[label](https://evil.example)` whose `[` and `]` are both unescaped. */
const LIVE_EVIL =
  /(^|[^\\])(\\\\)*\[[^\n]*(?<!\\)\]\(https:\/\/evil\.example\)/;
const EVIL = '[Free gold](https://evil.example)';
const URL = 'https://raid.example';
const MEMBER = { id: 1, userId: 9, displayName: 'Ann', discordId: 'd-9' };

interface Created {
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

function embedService(): DiscordNotificationEmbedService {
  const settings = { getClientUrl: jest.fn().mockResolvedValue(URL) };
  return new DiscordNotificationEmbedService(
    settings as unknown as SettingsService,
  );
}

/** Run a lineup producer, then render what it created as the Discord DM. */
async function renderProduced(
  send: (n: NotificationService, d: NotificationDedupService) => Promise<void>,
) {
  const created: Created[] = [];
  const notifications = {
    create: (arg: Created) => {
      created.push(arg);
      return Promise.resolve(null);
    },
  };
  const dedup = { checkAndMarkSent: () => Promise.resolve(false) };
  await send(
    notifications as unknown as NotificationService,
    dedup as unknown as NotificationDedupService,
  );
  const input = created[0];
  if (!input) throw new Error('the producer created no notification');
  const { embed } = await embedService().buildNotificationEmbed(
    { notificationId: 'n-1', ...input },
    'Raid Ledger',
  );
  return embed.toJSON();
}

describe('bot-authored lineup links stay clickable', () => {
  it('keeps the voting ballot game links live while user text is escaped', async () => {
    const lineup = { id: 3, title: EVIL, description: `Bring ${EVIL}` };
    const games = [
      { id: 7, name: 'Valheim' },
      { id: 8, name: EVIL },
    ];
    const { title, description } = await renderProduced((n, d) =>
      sendVotingDM(n, d, lineup, MEMBER, games, URL),
    );
    expect(description).toContain(`[**Valheim**](${URL}/games/7)`);
    expect(description).toContain(
      `[**\\[Free gold\\](https://evil.example)**](${URL}/games/8)`,
    );
    expect(description).not.toMatch(LIVE_EVIL);
    expect(title).not.toMatch(LIVE_EVIL);
  });

  it('keeps the tiebreaker vote CTA live while tied game names are escaped', async () => {
    const tiebreaker = {
      id: 4,
      mode: 'bracket' as const,
      tiedGames: [{ id: 8, name: EVIL }],
    };
    const { description } = await renderProduced((n, d) =>
      sendTiebreakerOpenDM(n, d, { id: 3 }, tiebreaker, MEMBER, URL),
    );
    expect(description).toMatch(
      /(^|[^\\])\[Vote in the bracket\]\(https:\/\/raid\.example\/community-lineup\/3\)/,
    );
    expect(description).not.toMatch(LIVE_EVIL);
  });
});

describe('escaped DM text still fits Discord limits', () => {
  const longTitle = `${'['.repeat(100)}${'a'.repeat(85)}](https://x.co)`;

  it('a 200-char bracket-heavy title still builds an embed of <= 256 chars', async () => {
    expect(longTitle).toHaveLength(200);
    const { embed } = await embedService().buildNotificationEmbed(
      {
        notificationId: 'n-2',
        type: 'event_reminder',
        title: `Spots Available — ${longTitle}`,
        message: `'${longTitle}' needs you.`,
      },
      'Raid Ledger',
    );
    const title = embed.toJSON().title ?? '';
    expect(title.length).toBeLessThanOrEqual(DISCORD_LIMITS.title);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/(^|[^\\])(\\\\)*\\…$/);
  });

  it('never ends on half an escape or half a surrogate pair', () => {
    expect(fitDiscordText('ab\\[cd', 4)).toBe('ab…');
    expect(fitDiscordText('ab\\\\cd', 5)).toBe('ab\\\\…');
    expect(fitDiscordText('abc😀d', 5)).toBe('abc…');
    expect(fitDiscordText('short', 10)).toBe('short');
  });
});

describe('post-event follow-up prompt DM', () => {
  it('shows a masked-link event title as plain text', () => {
    const svc = new PostEventFollowupPromptService(
      undefined as never,
      undefined as never,
    );
    const event = { id: 1, title: EVIL, creator_id: 2, game_id: null };
    const { description } = svc['buildEmbed'](event).toJSON();
    expect(description).not.toMatch(LIVE_EVIL);
    expect(description).toContain('\\[Free gold](https://evil.example)');
  });
});
