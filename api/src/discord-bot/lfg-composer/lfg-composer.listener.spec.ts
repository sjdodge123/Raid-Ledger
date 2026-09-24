/**
 * ROK-1612 — the composer listener routes `lfgc:*` and nothing else, and a
 * failing step answers rather than leaving "This interaction failed".
 */
import {
  backToComposerCandidates,
  goComposer,
  openComposerModal,
  pickComposerGame,
  submitComposerSearch,
} from './lfg-composer-flow.helpers';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import { LFG_COMPOSER_COPY } from './lfg-composer.constants';
import { viewComposerGames } from './lfg-composer-view.helpers';
import {
  LfgComposerListener,
  isComposerInteraction,
  routeComposerInteraction,
} from './lfg-composer.listener';

jest.mock('./lfg-composer-flow.helpers', () => ({
  backToComposerCandidates: jest.fn().mockResolvedValue(undefined),
  goComposer: jest.fn().mockResolvedValue(undefined),
  openComposerModal: jest.fn().mockResolvedValue(undefined),
  pickComposerGame: jest.fn().mockResolvedValue(undefined),
  submitComposerSearch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lfg-composer-view.helpers', () => ({
  viewComposerGames: jest.fn().mockResolvedValue(undefined),
}));

type Kind = 'button' | 'select' | 'modal';

function fake(kind: Kind, customId: string, deferred = false) {
  return {
    customId,
    deferred,
    replied: false,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const DEPS = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('isComposerInteraction', () => {
  it('claims lfgc: ids and leaves every other family alone', () => {
    expect(isComposerInteraction(fake('button', 'lfgc:open') as never)).toBe(
      true,
    );
    expect(isComposerInteraction(fake('button', 'lfg:join:7') as never)).toBe(
      false,
    );
  });
});

describe('routeComposerInteraction', () => {
  it.each([
    ['button', 'lfgc:open', openComposerModal],
    ['button', 'lfgc:back:deep rok', openComposerModal],
    ['button', 'lfgc:backc:deep', backToComposerCandidates],
    ['button', 'lfgc:go:week:7:s:deep', goComposer],
    ['select', 'lfgc:pick:deep', pickComposerGame],
    ['modal', 'lfgc:modal', submitComposerSearch],
    ['button', 'lfgc:view', viewComposerGames],
  ] as const)('%s %s reaches its step', async (kind, id, step) => {
    await routeComposerInteraction(DEPS, fake(kind, id) as never);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('hands the typed term to Back, and none to the card button', async () => {
    await routeComposerInteraction(
      DEPS,
      fake('button', 'lfgc:back:a:b') as never,
    );
    await routeComposerInteraction(DEPS, fake('button', 'lfgc:open') as never);
    const prefills = jest.mocked(openComposerModal).mock.calls.map((c) => c[2]);
    expect(prefills).toEqual(['a:b', '']);
  });

  it('owns no step for an unknown lfgc id', () => {
    expect(
      routeComposerInteraction(DEPS, fake('button', 'lfgc:nope') as never),
    ).toBeNull();
  });
});

describe('LfgComposerListener.handle', () => {
  it('answers a failed step instead of letting the interaction fail', async () => {
    jest.mocked(goComposer).mockRejectedValueOnce(new Error('db down'));
    const listener = new LfgComposerListener(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const i = fake('button', 'lfgc:go:week:7:s:deep');
    await listener.handle(i as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/went wrong/) }),
    );
  });

  it('answers an unknown lfgc id with the stale reply, not "interaction failed"', async () => {
    const listener = new LfgComposerListener(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const i = fake('button', 'lfgc:nope');
    await listener.handle(i as never);
    expect(i.reply).toHaveBeenCalledWith({
      content: LFG_COMPOSER_COPY.STALE_REPLY,
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('LfgComposerListener.handle logging (ROK-1685 AC4)', () => {
  it('logs a failed step without the request body, so no token leaks', async () => {
    const lines: string[] = [];
    for (const level of ['error', 'warn', 'log'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args) => {
        lines.push(args.map((a) => inspect(a, { depth: 10 })).join(' '));
      });
    }
    const apiError = Object.assign(new Error('Invalid Form Body'), {
      code: 50035,
      requestBody: {
        json: { components: [{ url: 'https://rl.test/games#token=SECRET' }] },
      },
    });
    jest.mocked(viewComposerGames).mockRejectedValueOnce(apiError);
    const listener = new LfgComposerListener(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await listener.handle(fake('button', 'lfgc:view', true) as never);
    const logged = lines.join('\n');
    expect(logged).toContain('lfgc:view');
    expect(logged).toContain('Invalid Form Body');
    expect(logged).toContain('50035');
    expect(logged).not.toContain('SECRET');
    jest.restoreAllMocks();
  });
});
