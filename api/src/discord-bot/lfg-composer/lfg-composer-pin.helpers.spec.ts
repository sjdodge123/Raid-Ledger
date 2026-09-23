/**
 * ROK-1612 AC1 (operator ruling 2026-09-22 "pin it") — pin idempotency.
 *
 * Fakes a Discord text channel with a real pin list and history, then boots
 * the composer twice. The invariant under test: exactly one card, pinned when
 * allowed, and a second boot never creates a message.
 */
import { buildComposerCard } from './lfg-composer-card.helpers';
import {
  ensurePinnedComposer,
  isOwnComposer,
  type ComposerChannel,
  type ComposerMessage,
  type ComposerPayload,
  type EnsureComposerDeps,
} from './lfg-composer-pin.helpers';
import { LFG_COMPOSER_IDS } from './lfg-composer.constants';

const BOT = 'bot-user';

interface FakeChannel extends ComposerChannel {
  all: ComposerMessage[];
  sends: number;
}

function fakeMessage(
  channel: FakeChannel,
  author: string,
  customIds: string[],
  pinError?: { code: number },
): ComposerMessage {
  const message: ComposerMessage = {
    id: `m${String(channel.all.length + 1)}`,
    pinned: false,
    author: { id: author },
    components: [{ components: customIds.map((customId) => ({ customId })) }],
    edit: jest.fn(() => Promise.resolve()),
    pin: jest.fn(() => {
      if (pinError)
        return Promise.reject(Object.assign(new Error('no'), pinError));
      message.pinned = true;
      return Promise.resolve();
    }),
    delete: jest.fn(() => {
      channel.all = channel.all.filter((m) => m !== message);
      return Promise.resolve();
    }),
  };
  channel.all.push(message);
  return message;
}

function fakeChannel(pinError?: { code: number }): FakeChannel {
  const channel: FakeChannel = {
    id: 'lfg-text',
    all: [],
    sends: 0,
    send: jest.fn(() => {
      channel.sends += 1;
      return Promise.resolve(
        fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN], pinError),
      );
    }),
    messages: {
      fetchPins: () =>
        Promise.resolve({
          items: channel.all
            .filter((m) => m.pinned)
            .map((message) => ({ message })),
        }),
      fetch: () => Promise.resolve(channel.all.slice().reverse()),
    },
  };
  return channel;
}

function deps(channel: FakeChannel, warn = jest.fn()): EnsureComposerDeps {
  const card = buildComposerCard('https://raid.example');
  const payload: ComposerPayload = card;
  return { channel, botUserId: BOT, payload, warn, warned: new Set() };
}

function ownComposers(channel: FakeChannel): ComposerMessage[] {
  return channel.all.filter((m) => isOwnComposer(m, BOT));
}

describe('ensurePinnedComposer (ROK-1612 AC1 — a real pin)', () => {
  it('first boot posts the card and pins it', async () => {
    const channel = fakeChannel();
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'posted-pinned',
    );
    expect(ownComposers(channel)).toHaveLength(1);
    expect(ownComposers(channel)[0].pinned).toBe(true);
  });

  it('second boot edits the same pinned message and never posts again', async () => {
    const channel = fakeChannel();
    await ensurePinnedComposer(deps(channel));
    const first = ownComposers(channel)[0];
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'edited-pinned',
    );
    expect(channel.sends).toBe(1);
    expect(ownComposers(channel)).toEqual([first]);
    expect(first.edit).toHaveBeenCalledTimes(1);
  });

  it('ignores a member message that happens to carry the same button id', async () => {
    const channel = fakeChannel();
    const impostor = fakeMessage(channel, 'member', [LFG_COMPOSER_IDS.OPEN]);
    impostor.pinned = true;
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'posted-pinned',
    );
    expect(impostor.edit).not.toHaveBeenCalled();
  });

  it('sweeps a leaked second pinned card so exactly one remains', async () => {
    const channel = fakeChannel();
    const a = fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN]);
    const b = fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN]);
    a.pinned = true;
    b.pinned = true;
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'edited-pinned',
    );
    expect(ownComposers(channel)).toHaveLength(1);
    expect(channel.sends).toBe(0);
  });
});

describe('ensurePinnedComposer — stray duplicates (review MINOR)', () => {
  it('keeps the pinned card and deletes older unpinned duplicates of its own', async () => {
    const channel = fakeChannel();
    const stray = fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN]);
    const member = fakeMessage(channel, 'member', [LFG_COMPOSER_IDS.OPEN]);
    const kept = fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN]);
    kept.pinned = true;
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'edited-pinned',
    );
    expect(ownComposers(channel)).toEqual([kept]);
    expect(stray.delete).toHaveBeenCalledTimes(1);
    expect(member.delete).not.toHaveBeenCalled();
    expect(channel.sends).toBe(0);
  });
});

describe('ensurePinnedComposer — permission fallback (AC7)', () => {
  it('missing Manage Messages (50013) falls back to an unpinned post and warns once', async () => {
    const channel = fakeChannel({ code: 50013 });
    const warn = jest.fn();
    const shared = deps(channel, warn);
    await expect(ensurePinnedComposer(shared)).resolves.toBe('posted-unpinned');
    expect(ownComposers(channel)).toHaveLength(1);
    expect(ownComposers(channel)[0].pinned).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Manage Messages');

    // A restart with the permission still missing adopts the unpinned card:
    // no second post, and no second warning from the same process.
    await expect(ensurePinnedComposer(shared)).resolves.toBe(
      'adopted-unpinned',
    );
    expect(channel.sends).toBe(1);
    expect(ownComposers(channel)).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('pins an adopted unpinned card once the permission is granted', async () => {
    const channel = fakeChannel();
    const orphan = fakeMessage(channel, BOT, [LFG_COMPOSER_IDS.OPEN]);
    await expect(ensurePinnedComposer(deps(channel))).resolves.toBe(
      'adopted-pinned',
    );
    expect(orphan.pinned).toBe(true);
    expect(channel.sends).toBe(0);
  });
});
