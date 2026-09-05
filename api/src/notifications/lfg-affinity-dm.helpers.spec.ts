import * as helpers from './lfg-affinity-dm.helpers';
import {
  buildLfgInviteLines,
  buildLfgInviteUrl,
} from './lfg-affinity-dm.helpers';

describe('lfg-affinity-dm.helpers (ROK-1471 D11)', () => {
  const input = {
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    memberCount: 2,
    clientUrl: 'https://raid.example.net',
  };

  describe('buildLfgInviteUrl', () => {
    it('links to the LFG group page for the slug', () => {
      expect(buildLfgInviteUrl('https://raid.example.net', 'deep-rock')).toBe(
        'https://raid.example.net/lfg/deep-rock',
      );
    });

    it('trims a trailing slash on the client url', () => {
      expect(buildLfgInviteUrl('https://raid.example.net/', 'drg')).toBe(
        'https://raid.example.net/lfg/drg',
      );
    });

    it('returns null without a client url', () => {
      expect(buildLfgInviteUrl(null, 'drg')).toBeNull();
    });
  });

  describe('buildLfgInviteLines', () => {
    it('renders the game, the count line and the join link', () => {
      const lines = buildLfgInviteLines(input);
      expect(lines[0]).toContain('Deep Rock Galactic');
      expect(lines.join('\n')).toContain('2 looking to play');
      expect(lines.join('\n')).toContain(
        'https://raid.example.net/lfg/deep-rock-galactic',
      );
    });

    it('singularises the count line for one member', () => {
      expect(
        buildLfgInviteLines({ ...input, memberCount: 1 }).join('\n'),
      ).toContain('1 looking to play');
    });

    it('omits the link line when no client url is configured', () => {
      const text = buildLfgInviteLines({ ...input, clientUrl: null }).join(
        '\n',
      );
      expect(text).toContain('2 looking to play');
      expect(text).not.toContain('](');
    });
  });

  // The DM chrome is NOT this module's: `lfg_invite` renders through
  // `DiscordNotificationEmbedService.buildNotificationEmbed` like every other
  // notification type, and `applyLfgInviteEmbed` supplies only the body. The
  // parallel `createDmEmbed` builder that used to live here had no production
  // caller, so its three green tests asserted an artefact no user received.
  it('exports no second, caller-less embed builder (ROK-1471 review R3)', () => {
    expect(Object.keys(helpers)).toEqual(
      expect.not.arrayContaining(['buildLfgInviteDmEmbed']),
    );
    expect(Object.keys(helpers)).toEqual(
      expect.arrayContaining(['applyLfgInviteEmbed']),
    );
  });
});
