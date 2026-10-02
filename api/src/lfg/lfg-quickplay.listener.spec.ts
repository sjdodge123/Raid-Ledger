/**
 * ROK-1451 AC7d — `LFG_EVENTS.QUICK_PLAY_MATCH` fires for a Quick Play
 * participant who holds a matching active intent, and never otherwise.
 *
 * On a Quick Play session the listener is a pure SIGNAL: it must never clear an
 * intent (AC7c), so those cases assert that no UPDATE was issued and that the
 * one-holder converter was never reached.
 *
 * ROK-1625 — a join on the game's open LFG-born event converts the joiner's own
 * hand instead, keyed on the exact event id, and is driven by the roster seam
 * (PARTICIPANT_JOINED), never by voiceStateUpdate. A row that moved is then
 * announced as GROUP_CHANGED (`playing`), after the write.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { AD_HOC_EVENTS } from '../discord-bot/discord-bot.constants';
import { LFG_EVENTS } from './lfg.constants';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';
import { findOpenLfgNowEventId } from './lfg-playing.helpers';
import { convertHolderIntent } from './lfg-write.helpers';

jest.mock('./lfg-playing.helpers', () => ({
  findOpenLfgNowEventId: jest.fn(),
}));
jest.mock('./lfg-write.helpers', () => ({ convertHolderIntent: jest.fn() }));

const findOpen = findOpenLfgNowEventId as jest.MockedFunction<
  typeof findOpenLfgNowEventId
>;
const convertHolder = convertHolderIntent as jest.MockedFunction<
  typeof convertHolderIntent
>;

/** Block comments, then line comments — `://` in a URL is left alone. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

interface Harness {
  db: MockDb;
  emitter: EventEmitter2;
  listener: LfgQuickPlayListener;
}

/** A fresh listener; by default no LFG-born session is open for the game. */
function harness(): Harness {
  const db = createDrizzleMock();
  const emitter = new EventEmitter2();
  jest.spyOn(emitter, 'emit');
  findOpen.mockReset().mockResolvedValue(null);
  convertHolder.mockReset().mockResolvedValue(1);
  const listener = new LfgQuickPlayListener(
    db as unknown as PostgresJsDatabase<typeof schema>,
    emitter,
  );
  return { db, emitter, listener };
}

describe('LfgQuickPlayListener', () => {
  let db: MockDb;
  let emitter: EventEmitter2;
  let listener: LfgQuickPlayListener;

  beforeEach(() => {
    ({ db, emitter, listener } = harness());
  });

  it('emits QUICK_PLAY_MATCH when the participant holds a matching intent', async () => {
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // event lookup
      .mockResolvedValueOnce([{ id: 5 }]); // active intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.QUICK_PLAY_MATCH, {
      userId: 7,
      gameId: 99,
      eventId: 42,
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(convertHolder).not.toHaveBeenCalled();
  });

  it('stays silent when the participant holds no intent for that game', async () => {
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([]);

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(convertHolder).not.toHaveBeenCalled();
  });

  it('stays silent for an unlinked Discord participant (null userId)', async () => {
    await listener.onParticipantJoined({ eventId: 42, userId: null });

    expect(db.select).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('stays silent when the session has no game', async () => {
    db.limit.mockResolvedValueOnce([{ gameId: null }]);

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('swallows a DB failure instead of throwing into the emitter', async () => {
    db.limit.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      listener.onParticipantJoined({ eventId: 42, userId: 7 }),
    ).resolves.toBeUndefined();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('LfgQuickPlayListener — ROK-1625 join on the LFG-born session', () => {
  let db: MockDb;
  let emitter: EventEmitter2;
  let listener: LfgQuickPlayListener;

  beforeEach(() => {
    ({ db, emitter, listener } = harness());
  });

  it("converts the joiner's own hand, then repaints as playing — no Quick Play signal", async () => {
    // MUTATION: drop the GROUP_CHANGED emit after a conversion and the
    // `toHaveBeenNthCalledWith` below fails with Number of calls: 0.
    findOpen.mockResolvedValue(42);
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // event lookup
      .mockResolvedValueOnce([{ id: 5 }]); // live intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(findOpen).toHaveBeenCalledWith(db, 99);
    expect(convertHolder).toHaveBeenCalledTimes(1);
    expect(convertHolder).toHaveBeenCalledWith(db, 99, 7, { eventId: 42 });
    expect(emitter.emit).toHaveBeenNthCalledWith(1, LFG_EVENTS.GROUP_CHANGED, {
      gameId: 99,
      reason: 'playing',
      eventId: 42,
    });
    expect(emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('never reaches the LFG-born read for a joiner holding no live hand', async () => {
    // MUTATION: run `convertIfLfgBorn` before `holdsLiveIntent` and the
    // events x lfg_intents join is paid for a joiner with nothing to convert.
    findOpen.mockResolvedValue(42);
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // event lookup
      .mockResolvedValueOnce([]); // no live intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(findOpen).not.toHaveBeenCalled();
    expect(convertHolder).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('is a safe no-op when the joiner already converted (AC4)', async () => {
    findOpen.mockResolvedValue(42);
    convertHolder.mockResolvedValue(0);
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([{ id: 5 }]);

    await expect(
      listener.onParticipantJoined({ eventId: 42, userId: 7 }),
    ).resolves.toBeUndefined();
    expect(convertHolder).toHaveBeenCalledWith(db, 99, 7, { eventId: 42 });
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('LfgQuickPlayListener — ROK-1625 scoping and failure', () => {
  let db: MockDb;
  let emitter: EventEmitter2;
  let listener: LfgQuickPlayListener;

  beforeEach(() => {
    ({ db, emitter, listener } = harness());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scopes to the exact event: a Quick Play join for the same game only signals (AC2)', async () => {
    findOpen.mockResolvedValue(77); // LFG-born session 77 is open for game 99
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // QP event 42
      .mockResolvedValueOnce([{ id: 5 }]); // live intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(convertHolder).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.QUICK_PLAY_MATCH, {
      userId: 7,
      gameId: 99,
      eventId: 42,
    });
  });

  it('logs a warning naming the event when the conversion fails (AC5)', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findOpen.mockResolvedValue(42);
    convertHolder.mockRejectedValue(new Error('deadlock detected'));
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([{ id: 5 }]);

    await expect(
      listener.onParticipantJoined({ eventId: 42, userId: 7 }),
    ).resolves.toBeUndefined();
    expect(emitter.emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /LFG roster-join handling failed for event 42: deadlock detected/,
      ),
    );
  });

  it('converts nothing for an unlinked Discord participant (null userId)', async () => {
    findOpen.mockResolvedValue(42);

    await listener.onParticipantJoined({ eventId: 42, userId: null });

    expect(convertHolder).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('ROK-1625 AC6 — driven by the roster seam, never voice state', () => {
  it('subscribes exactly onParticipantJoined to PARTICIPANT_JOINED', () => {
    // Scanned by method, so a missing subscription reads as `[]`, not a throw.
    const proto = LfgQuickPlayListener.prototype as unknown as Record<
      string,
      unknown
    >;
    const subscribed = Object.getOwnPropertyNames(proto).filter((name) => {
      const method = proto[name];
      if (typeof method !== 'function') return false;
      const events = Reflect.getMetadata('EVENT_LISTENER_METADATA', method) as
        { event: unknown }[] | undefined;
      return (events ?? []).some(
        (e) => e.event === AD_HOC_EVENTS.PARTICIPANT_JOINED,
      );
    });
    expect(subscribed).toEqual(['onParticipantJoined']);
  });

  it('never references voice state in code (comments stripped first)', () => {
    const code = stripComments(
      readFileSync(join(__dirname, 'lfg-quickplay.listener.ts'), 'utf8'),
    );
    expect(code).toContain('AD_HOC_EVENTS.PARTICIPANT_JOINED');
    expect(code).not.toMatch(/voiceStateUpdate|VoiceStateUpdate|VoiceState/);
  });
});
