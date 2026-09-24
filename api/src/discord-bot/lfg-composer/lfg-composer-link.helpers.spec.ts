/**
 * ROK-1685 AC1/AC2/AC4 — the private replies' `View games ↗` carries a magic
 * link minted for the clicking Discord user, fitted under Discord's 512 cap.
 */
import { resolveLfgCaller } from '../commands/lfg.command';
import { DISCORD_LINK_URL_MAX } from './lfg-composer-card.helpers';
import {
  resolveComposerGamesUrl,
  type ComposerLinkDeps,
} from './lfg-composer-link.helpers';

jest.mock('../commands/lfg.command', () => ({ resolveLfgCaller: jest.fn() }));

const caller = jest.mocked(resolveLfgCaller);

const BASE = 'https://rl.test';
const LINKED = { id: 42, deactivatedAt: null, bannedAt: null };

function deps(
  clientUrl: string | null = BASE,
  token = 'FAKE',
): ComposerLinkDeps & { generateLink: jest.Mock } {
  const generateLink = jest
    .fn()
    .mockImplementation((_id: number, path: string, base: string) =>
      Promise.resolve(`${base}${path}#token=${token}`),
    );
  return {
    db: {} as never,
    settingsService: { getClientUrl: jest.fn().mockResolvedValue(clientUrl) },
    magicLinkService: { generateLink },
    generateLink,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  caller.mockResolvedValue(LINKED);
});

describe('resolveComposerGamesUrl (ROK-1685)', () => {
  it('mints once for the linked caller and fits the term before the token', async () => {
    const d = deps();
    const url = await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    expect(caller).toHaveBeenCalledWith(d.db, 'discord-1');
    expect(d.generateLink).toHaveBeenCalledTimes(1);
    expect(d.generateLink).toHaveBeenCalledWith(42, '/games', BASE);
    expect(url).toBe(`${BASE}/games?q=deep+rock#token=FAKE`);
  });

  it.each([
    ['unlinked', null],
    ['banned', { ...LINKED, bannedAt: new Date() }],
    ['deactivated', { ...LINKED, deactivatedAt: new Date() }],
  ])('an %s clicker gets plain /games and no token', async (_, who) => {
    caller.mockResolvedValue(who);
    const d = deps();
    const url = await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    expect(url).toBe(`${BASE}/games?q=deep+rock`);
    expect(d.generateLink).not.toHaveBeenCalled();
  });

  it('falls back to plain /games when generateLink finds no user', async () => {
    const d = deps();
    d.generateLink.mockResolvedValue(null);
    const url = await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    expect(url).toBe(`${BASE}/games?q=deep+rock`);
  });

  it('falls back to plain /games when the bare minted link is over the cap', async () => {
    const d = deps(BASE, 'x'.repeat(DISCORD_LINK_URL_MAX));
    const url = await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    expect(url).toBe(`${BASE}/games?q=deep+rock`);
  });

  it.each([null, '  '])(
    'an unset client URL (%p) links nothing and mints nothing',
    async (clientUrl) => {
      const d = deps(clientUrl);
      const url = await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
      expect(url).toBeNull();
      expect(d.generateLink).not.toHaveBeenCalled();
    },
  );

  it('mints a fresh token on every call — nothing is cached', async () => {
    const d = deps();
    await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    await resolveComposerGamesUrl(d, 'discord-1', 'deep rock');
    expect(d.generateLink).toHaveBeenCalledTimes(2);
  });

  it('a realistic token and a 64-char unicode term stay within 512', async () => {
    const token = 't'.repeat(300);
    const d = deps(BASE, token);
    const term = '漢'.repeat(64);
    const url = await resolveComposerGamesUrl(d, 'discord-1', term);
    expect(url!.length).toBeLessThanOrEqual(DISCORD_LINK_URL_MAX);
    expect(url!.endsWith(`#token=${token}`)).toBe(true);
    expect(url).toContain('/games?q=%E6%BC%A2');
  });
});
