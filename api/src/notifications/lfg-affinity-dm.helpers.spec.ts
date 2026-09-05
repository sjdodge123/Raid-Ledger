import {
  buildLfgInviteDmEmbed,
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
      expect(buildLfgInviteLines({ ...input, memberCount: 1 }).join('\n')).toContain(
        '1 looking to play',
      );
    });

    it('omits the link line when no client url is configured', () => {
      const text = buildLfgInviteLines({ ...input, clientUrl: null }).join('\n');
      expect(text).toContain('2 looking to play');
      expect(text).not.toContain('](');
    });
  });

  describe('buildLfgInviteDmEmbed', () => {
    it('builds with the shared DM chrome — author, footer and a chrome colour', () => {
      const embed = buildLfgInviteDmEmbed(input);
      expect(embed.data.author?.name).toBe('Raid Ledger');
      expect(embed.data.footer?.text).toContain('Raid Ledger');
      expect(typeof embed.data.color).toBe('number');
    });

    it('describes the group with the count line and the join link', () => {
      const embed = buildLfgInviteDmEmbed(input);
      expect(embed.data.description).toContain('2 looking to play');
      expect(embed.data.description).toContain(
        'https://raid.example.net/lfg/deep-rock-galactic',
      );
    });

    it('honours the community name in the chrome', () => {
      const embed = buildLfgInviteDmEmbed({ ...input, communityName: 'Gamer Night' });
      expect(embed.data.author?.name).toBe('Gamer Night');
    });
  });
});
