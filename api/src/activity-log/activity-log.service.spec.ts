/**
 * Unit tests for `stripDiscordIdentifiers` (ROK-1824, backlog 3156): raw
 * Discord identifiers must be dropped at every depth of a metadata blob, not
 * just the top level.
 */
import { stripDiscordIdentifiers } from './activity-log.service';

/** Nest `{ child: ... }` `levels` deep around `leaf`. */
function nestBlob(levels: number, leaf: unknown): unknown {
  let blob: unknown = leaf;
  for (let i = 0; i < levels; i++) blob = { child: blob };
  return blob;
}

describe('stripDiscordIdentifiers', () => {
  it('drops top-level Discord identifier keys', () => {
    expect(
      stripDiscordIdentifiers({ discordUserId: '1', DiscordName: 'x', ok: 1 }),
    ).toEqual({ ok: 1 });
  });

  it('drops Discord identifier keys inside nested objects', () => {
    expect(
      stripDiscordIdentifiers({ p: { discordUserId: '1', ok: 1 } }),
    ).toEqual({ p: { ok: 1 } });
  });

  it('drops Discord identifier keys from objects inside arrays', () => {
    expect(
      stripDiscordIdentifiers({
        participants: [
          { discordId: '9', name: 'a' },
          { userId: 2, discordUsername: 'b' },
          'plain',
        ],
      }),
    ).toEqual({ participants: [{ name: 'a' }, { userId: 2 }, 'plain'] });
  });

  it('returns null for non-object or array input', () => {
    expect(stripDiscordIdentifiers(null)).toBeNull();
    expect(stripDiscordIdentifiers('discordUserId')).toBeNull();
    expect(stripDiscordIdentifiers(42)).toBeNull();
    expect(stripDiscordIdentifiers([{ discordId: '1' }])).toBeNull();
  });

  it('drops a subtree nested past the depth bound instead of recursing', () => {
    const result = stripDiscordIdentifiers(
      nestBlob(20, { discordUserId: '1' }),
    );
    expect(JSON.stringify(result)).not.toContain('discordUserId');
    expect(JSON.stringify(result)).not.toContain('"1"');
  });
});
