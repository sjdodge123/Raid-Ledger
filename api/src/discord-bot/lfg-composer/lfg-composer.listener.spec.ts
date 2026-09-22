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

type Kind = 'button' | 'select' | 'modal';

function fake(kind: Kind, customId: string) {
  return {
    customId,
    deferred: false,
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
  ] as const)('%s %s reaches its step', async (kind, id, step) => {
    await routeComposerInteraction(DEPS, fake(kind, id) as never);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('hands the typed term to Back, and none to the card button', async () => {
    await routeComposerInteraction(DEPS, fake('button', 'lfgc:back:a:b') as never);
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
    );
    const i = fake('button', 'lfgc:go:week:7:s:deep');
    await listener.handle(i as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/went wrong/) }),
    );
  });
});
