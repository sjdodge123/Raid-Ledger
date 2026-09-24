/**
 * ROK-1685 AC3/AC4 — the pinned card's `View games ↗` press answers only the
 * clicker, privately, with a link minted for that clicker and nobody else.
 */
import { MessageFlags } from 'discord.js';
import { resolveLfgCaller } from '../commands/lfg.command';
import { LFG_COMPOSER_COPY } from './lfg-composer.constants';
import { viewComposerGames } from './lfg-composer-view.helpers';

jest.mock('../commands/lfg.command', () => ({ resolveLfgCaller: jest.fn() }));

const caller = jest.mocked(resolveLfgCaller);

const BASE = 'https://rl.test';
const ACCOUNTS: Record<string, number> = { a: 42, b: 43 };

function deps(clientUrl: string | null = BASE) {
  let minted = 0;
  const generateLink = jest
    .fn()
    .mockImplementation((userId: number, path: string, base: string) => {
      minted += 1;
      return Promise.resolve(`${base}${path}#token=T${userId}-${minted}`);
    });
  return {
    db: {} as never,
    settingsService: { getClientUrl: jest.fn().mockResolvedValue(clientUrl) },
    magicLinkService: { generateLink },
    generateLink,
  };
}

function press(discordId: string) {
  return {
    customId: 'lfgc:view',
    user: { id: discordId },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

type Press = ReturnType<typeof press>;

/** The one edit's Link button URLs, read off the builders' JSON. */
function linkUrls(i: Press): string[] {
  const payload = i.editReply.mock.calls[0]?.[0] as {
    components?: { toJSON(): { components: { url?: string }[] } }[];
  };
  return (payload?.components ?? []).flatMap((row) =>
    row.toJSON().components.map((c) => c.url ?? ''),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  caller.mockImplementation((_db, discordId: string) => {
    const id = ACCOUNTS[discordId];
    const found = id ? { id, deactivatedAt: null, bannedAt: null } : null;
    return Promise.resolve(found as never);
  });
});

describe('viewComposerGames (ROK-1685 AC3/AC4)', () => {
  it('acknowledges ephemerally and never replies in public', async () => {
    const i = press('a');
    await viewComposerGames(deps(), i as never);
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const publicReplies = i.reply.mock.calls.filter(
      ([p]) => (p as { flags?: number }).flags !== MessageFlags.Ephemeral,
    );
    expect(publicReplies).toEqual([]);
  });

  it('mints for each clicker their own identity, never the other one', async () => {
    const d = deps();
    const a = press('a');
    const b = press('b');
    await viewComposerGames(d, a as never);
    await viewComposerGames(d, b as never);
    expect(d.generateLink.mock.calls.map((c) => c[0])).toEqual([42, 43]);
    expect(linkUrls(a)).toEqual([`${BASE}/games#token=T42-1`]);
    expect(linkUrls(b)).toEqual([`${BASE}/games#token=T43-2`]);
  });

  it('gives a clicker with no account plain /games and mints nothing', async () => {
    const d = deps();
    const i = press('stranger');
    await viewComposerGames(d, i as never);
    expect(linkUrls(i)).toEqual([`${BASE}/games`]);
    expect(d.generateLink).not.toHaveBeenCalled();
  });

  it('mints a fresh link on every press — nothing is cached', async () => {
    const d = deps();
    const first = press('a');
    const second = press('a');
    await viewComposerGames(d, first as never);
    await viewComposerGames(d, second as never);
    expect(d.generateLink).toHaveBeenCalledTimes(2);
    expect(linkUrls(first)).toEqual([`${BASE}/games#token=T42-1`]);
    expect(linkUrls(second)).toEqual([`${BASE}/games#token=T42-2`]);
  });

  it('edits in a text reply with no link when the web URL is gone', async () => {
    const d = deps(null);
    const i = press('a');
    await viewComposerGames(d, i as never);
    expect(i.editReply).toHaveBeenCalledWith({
      content: LFG_COMPOSER_COPY.FAILED_REPLY,
      components: [],
    });
    expect(d.generateLink).not.toHaveBeenCalled();
  });
});
