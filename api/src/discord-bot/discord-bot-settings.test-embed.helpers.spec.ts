/**
 * ROK-1477 (Lane A) — the admin "test message" embed.
 *
 * Extracted from `discord-bot-settings.controller.ts` (D7: the controller sat
 * at 298/300 counted lines) and then migrated onto the shared chrome (D3: the
 * test message is posted to a text channel, so it is a CHANNEL embed).
 */
import {
  TEST_EMBED_AUTHOR,
  buildTestEmbed,
  sendTestEmbed,
} from './discord-bot-settings.test-embed.helpers';
import { EMBED_COLORS } from './discord-bot.constants';
import { colorForState } from './embeds/embed-chrome.helpers';

describe('buildTestEmbed', () => {
  it('titles the embed with the community name', () => {
    expect(buildTestEmbed('Night Crew', null).data.title).toBe(
      'Night Crew is Online',
    );
  });

  it('opens the description with the community name in bold', () => {
    const desc = buildTestEmbed('Night Crew', null).data.description ?? '';
    expect(desc.split('\n')[0]).toBe(
      '**Night Crew** is now online and ready to go!',
    );
  });

  it('appends a masked link to the app when a client URL is configured', () => {
    const desc =
      buildTestEmbed('Night Crew', 'https://raid.example').data.description ??
      '';
    expect(desc).toContain('\u{1F517} [Open Night Crew](https://raid.example)');
  });

  it('omits the link line entirely when no client URL is configured', () => {
    const desc = buildTestEmbed('Night Crew', null).data.description ?? '';
    expect(desc).not.toContain('\u{1F517}');
  });

  // RE-POINTED (ROK-1477): the colour now comes from the state, not from a
  // palette literal. `done` IS slate, so nothing an operator sees changes —
  // the second assertion pins that equivalence so a future palette edit cannot
  // silently recolour this embed.
  it('renders slate — a test message is a settled fact, not an alert', () => {
    expect(buildTestEmbed('Night Crew', null).data.color).toBe(
      colorForState('done'),
    );
  });

  it('keeps the slate an operator already sees for this embed', () => {
    expect(colorForState('done')).toBe(EMBED_COLORS.SYSTEM);
  });

  it('carries the TEST MESSAGE author line', () => {
    expect(buildTestEmbed('Night Crew', null).data.author?.name).toBe(
      TEST_EMBED_AUTHOR,
    );
  });

  it('footers with the community name, not a second Raid Ledger line', () => {
    expect(buildTestEmbed('Night Crew', null).data.footer?.text).toBe(
      'Night Crew',
    );
  });

  it('sets a timestamp', () => {
    expect(buildTestEmbed('Night Crew', null).data.timestamp).toBeDefined();
  });
});

describe('sendTestEmbed', () => {
  const settings = {
    getBranding: jest.fn(),
    getClientUrl: jest.fn(),
  };
  const botClient = { sendEmbed: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.getBranding.mockResolvedValue({ communityName: 'Night Crew' });
    settings.getClientUrl.mockResolvedValue('https://raid.example');
    botClient.sendEmbed.mockResolvedValue(undefined);
  });

  it('sends the built embed to the requested channel', async () => {
    await sendTestEmbed(
      settings as unknown as Parameters<typeof sendTestEmbed>[0],
      botClient as unknown as Parameters<typeof sendTestEmbed>[1],
      '999',
    );
    expect(botClient.sendEmbed).toHaveBeenCalledTimes(1);
    const [channelId, embed] = botClient.sendEmbed.mock.calls[0] as [
      string,
      { data: { title?: string } },
    ];
    expect(channelId).toBe('999');
    expect(embed.data.title).toBe('Night Crew is Online');
  });

  it('falls back to the default community name when branding is unset', async () => {
    settings.getBranding.mockResolvedValue({ communityName: '' });
    await sendTestEmbed(
      settings as unknown as Parameters<typeof sendTestEmbed>[0],
      botClient as unknown as Parameters<typeof sendTestEmbed>[1],
      '999',
    );
    const [, embed] = botClient.sendEmbed.mock.calls[0] as [
      string,
      { data: { title?: string } },
    ];
    expect(embed.data.title).toBe('Raid Ledger is Online');
  });
});
