import { buildAcceptedEmbed, buildDeclinedEmbed } from './pug-invite.helpers';
import { colorForState } from '../embeds/embed-chrome.helpers';
import { NOTIFICATION_EMBED_AUTHORS } from '../../notifications/notification-embed.helpers';

/**
 * ROK-1477 (Lane C) — the PUG invite accept/decline DM cards moved onto the
 * shared chrome. Design line 470: "PUG invite loses its teal… the identity
 * moves to the author line".
 */
describe('pug invite DM chrome', () => {
  it('renders the accepted card in the live state', () => {
    const data = buildAcceptedEmbed("You're in!").data;
    expect(data.color).toBe(colorForState('live'));
    expect(data.author?.name).toBe(
      NOTIFICATION_EMBED_AUTHORS.PUG_INVITE_ACCEPTED,
    );
    expect(data.title).toBe('Invite Accepted!');
  });

  it('renders the declined card in the cancelled state', () => {
    const data = buildDeclinedEmbed().data;
    expect(data.color).toBe(colorForState('cancelled'));
    expect(data.author?.name).toBe(
      NOTIFICATION_EMBED_AUTHORS.PUG_INVITE_DECLINED,
    );
    expect(data.title).toBe('Invite Declined');
  });

  it('falls back to the default community in the footer', () => {
    expect(buildDeclinedEmbed().data.footer?.text).toBe('Raid Ledger');
  });
});
