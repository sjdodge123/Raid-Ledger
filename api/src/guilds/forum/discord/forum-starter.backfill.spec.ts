/**
 * ROK-2292 §3 — the starter-card backfill, unit level: which targets it
 * edits, that it records only after a successful edit, that one failure
 * never stops the rest, and the per-run cap. Qualification SQL and the
 * second-run no-op against real rows: `forum-starter.backfill.integration.spec.ts`.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { DiscordAPIError } from 'discord.js';
import { EMBED_STATES } from '../../../discord-bot/discord-bot.constants';
import type { EventForumStarterCards } from '../../../discord-bot/services/event-forum-starter.cards';
import {
  ForumStarterBackfill,
  STARTER_BACKFILL_CAP,
  starterBackfillTargets,
  type StarterBackfillTarget,
} from './forum-starter.backfill';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const STATE = EMBED_STATES.POSTED;
const t = (eventId: number): StarterBackfillTarget => ({
  eventId,
  discordThreadId: `thread-${eventId}`,
});

function setup(
  registry: StarterBackfillTarget[],
  hub: StarterBackfillTarget[],
) {
  const db: MockDb = createDrizzleMock();
  db.limit.mockResolvedValueOnce(registry).mockResolvedValueOnce(hub);
  const cards = {
    build: jest
      .fn()
      .mockResolvedValue({ embeds: [], components: [], state: STATE }),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const editor = { editStarter: jest.fn().mockResolvedValue('edited') };
  const svc = new ForumStarterBackfill(
    db as unknown as ForumDiscordDb,
    cards as unknown as EventForumStarterCards,
    editor,
  );
  return { db, cards, editor, svc };
}

describe('ROK-2292 starterBackfillTargets', () => {
  it('merges registry and hub posts by event id, capped', async () => {
    const { db } = setup([t(5), t(1)], [t(3)]);
    const got = await starterBackfillTargets(
      db as unknown as ForumDiscordDb,
      0,
      2,
    );
    expect(got).toEqual([t(1), t(3)]);
    expect(db.limit).toHaveBeenCalledWith(2);
  });

  it('caps each query at STARTER_BACKFILL_CAP by default', async () => {
    const { db } = setup([], []);
    await starterBackfillTargets(db as unknown as ForumDiscordDb);
    expect(db.limit.mock.calls).toEqual([
      [STARTER_BACKFILL_CAP],
      [STARTER_BACKFILL_CAP],
    ]);
  });
});

describe('ROK-2292 ForumStarterBackfill.run', () => {
  it('edits each starter to the card (no state field), then records it', async () => {
    const { svc, editor, cards } = setup([t(1)], [t(2)]);
    await expect(svc.run()).resolves.toBe(2);
    expect(editor.editStarter.mock.calls).toEqual([
      ['thread-1', { embeds: [], components: [] }],
      ['thread-2', { embeds: [], components: [] }],
    ]);
    expect(cards.record.mock.calls).toEqual([
      [1, 'thread-1', STATE],
      [2, 'thread-2', STATE],
    ]);
  });

  it('records nothing for a gone post or an event with no card', async () => {
    const { svc, editor, cards } = setup([t(1), t(2)], []);
    editor.editStarter.mockResolvedValueOnce('gone');
    cards.build
      .mockResolvedValueOnce({ embeds: [], components: [], state: STATE })
      .mockResolvedValueOnce(null);
    await expect(svc.run()).resolves.toBe(0);
    expect(editor.editStarter).toHaveBeenCalledTimes(1);
    expect(cards.record).not.toHaveBeenCalled();
  });

  it('one failing post (e.g. Discord 50005) is skipped; the rest go on', async () => {
    const { svc, editor, cards } = setup([t(1), t(2), t(3)], []);
    const err = Object.assign(
      new Error('Cannot edit a message authored by another user'),
      { code: 50005 },
    );
    editor.editStarter
      .mockResolvedValueOnce('edited')
      .mockRejectedValueOnce(err);
    await expect(svc.run()).resolves.toBe(2);
    expect(editor.editStarter).toHaveBeenCalledTimes(3);
    expect(cards.record.mock.calls.map((c) => c[1])).toEqual([
      'thread-1',
      'thread-3',
    ]);
  });

  it('edits strictly one at a time', async () => {
    const { svc, editor } = setup([t(1), t(2)], []);
    let inFlight = 0;
    let peak = 0;
    editor.editStarter.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return 'edited';
    });
    await svc.run();
    expect(peak).toBe(1);
  });

  it('onConnected never throws when the target read fails', async () => {
    const { svc, db } = setup([], []);
    db.limit.mockReset().mockRejectedValue(new Error('db down'));
    await expect(svc.onConnected()).resolves.toBeUndefined();
  });
});

function discordError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: `code ${code}` });
  return err;
}

/** The thread ids `editStarter` was called with, in order. */
const editedThreads = (editor: { editStarter: jest.Mock }): unknown[] =>
  editor.editStarter.mock.calls.map((c: unknown[]) => c[0]);

describe('ROK-2292 review NIT — the backfill does not retry unfixable posts', () => {
  it('a gone post (deleted / hub unbound) or a permanent error is skipped on the next connect', async () => {
    const { svc, editor, db } = setup([t(1), t(2), t(3)], []);
    editor.editStarter
      .mockResolvedValueOnce('gone')
      .mockRejectedValueOnce(discordError(50005))
      .mockResolvedValueOnce('edited');
    await svc.run();
    // Second connect: the same three still qualify (no starter row for 1, 2).
    db.limit.mockResolvedValueOnce([t(1), t(2)]).mockResolvedValueOnce([]);
    editor.editStarter.mockClear();
    await svc.run();
    expect(editedThreads(editor)).toEqual([]);
  });

  it('a transient failure is retried on the next connect', async () => {
    const { svc, editor, db } = setup([t(1)], []);
    editor.editStarter.mockRejectedValueOnce(
      new Error('Discord bot is offline'),
    );
    await svc.run();
    db.limit.mockResolvedValueOnce([t(1)]).mockResolvedValueOnce([]);
    editor.editStarter.mockClear();
    await svc.run();
    expect(editedThreads(editor)).toEqual(['thread-1']);
  });
});
