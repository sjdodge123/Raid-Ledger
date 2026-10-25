import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import type { SettingsService } from '../settings/settings.service';
import { submittedNotice } from '../guilds/community/hub-proposal-notices';
import { escapeHubName } from '../discord-bot/services/discord-embed-event-body.helpers';
import { hubProposalDiscordText } from './notification-embed.hub-proposal';

const EVIL = '[x](https://evil.example)';
const UNESCAPED_LINK = /(^|[^\\])\[x\]\(https:\/\/evil\.example\)/;
const facts = { proposalId: 7, gameName: 'BG3', hubName: EVIL };

function serviceWithClientUrl(): DiscordNotificationEmbedService {
  const settings = {
    getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
  };
  return new DiscordNotificationEmbedService(
    settings as unknown as SettingsService,
  );
}

describe('hub proposal notice — Discord DM escaping', () => {
  it('keeps the in-app notice text verbatim (no visible backslashes)', () => {
    const n = submittedNotice(3, facts, 'alice');
    expect(n.title).toBe(`New hub proposal: ${EVIL}`);
    expect(n.message).toContain(`"${EVIL}"`);
  });

  it('a masked-link hub name does not reach the staff DM as a link', async () => {
    const n = submittedNotice(3, facts, 'alice');
    const { embed } = await serviceWithClientUrl().buildNotificationEmbed(
      {
        notificationId: 'n-1',
        type: n.type,
        title: n.title,
        message: n.message,
        ...(n.payload ? { payload: n.payload } : {}),
      },
      'Raid Ledger',
    );
    const { title, description } = embed.toJSON();
    expect(title).not.toMatch(UNESCAPED_LINK);
    expect(description).not.toMatch(UNESCAPED_LINK);
    expect(title).toContain(escapeHubName(EVIL));
    expect(description).toContain(escapeHubName(EVIL));
  });

  it('escapes only hub_proposal_* types', () => {
    const text = { title: EVIL, message: EVIL };
    const payload = { hubName: EVIL };
    expect(
      hubProposalDiscordText({ type: 'event_reminder', ...text, payload }),
    ).toEqual(text);
    expect(
      hubProposalDiscordText({
        type: 'hub_proposal_reviewed',
        ...text,
        payload,
      }).title,
    ).toBe(escapeHubName(EVIL));
  });

  it('passes text through when the payload has no hubName', () => {
    const text = { title: 'T', message: 'M' };
    expect(
      hubProposalDiscordText({ type: 'hub_proposal_submitted', ...text }),
    ).toEqual(text);
  });
});

describe('hub proposal notice — proposer name in the Discord DM', () => {
  it('a masked-link proposer display name does not reach the staff DM as a link', async () => {
    const n = submittedNotice(3, { ...facts, hubName: 'BG3 Crew' }, EVIL);
    expect(n.message.startsWith(EVIL)).toBe(true);
    const { embed } = await serviceWithClientUrl().buildNotificationEmbed(
      {
        notificationId: 'n-2',
        type: n.type,
        title: n.title,
        message: n.message,
        ...(n.payload ? { payload: n.payload } : {}),
      },
      'Raid Ledger',
    );
    const { description } = embed.toJSON();
    expect(description).not.toMatch(UNESCAPED_LINK);
    expect(description).toContain(escapeHubName(EVIL));
    expect(description).toContain('"BG3 Crew"');
  });

  it('escapes the hub name and the proposer name in one pass', () => {
    const out = hubProposalDiscordText({
      type: 'hub_proposal_submitted',
      title: 'T',
      message: `${EVIL} proposed "${EVIL}" for BG3.`,
      payload: { hubName: EVIL, proposerName: EVIL },
    });
    const safe = escapeHubName(EVIL);
    expect(out.message).toBe(`${safe} proposed "${safe}" for BG3.`);
  });
});
