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
import {
  convertJoinerHand,
  findOpenLfgBornSessionGroup,
} from './lfg-session-group.helpers';
import { stripComments } from '../common/testing/strip-comments';

jest.mock('./lfg-session-group.helpers', () => ({
  findOpenLfgBornSessionGroup: jest.fn(),
  convertJoinerHand: jest.fn(),
}));

/** The joined event's group when it is an open LFG-born session, else null. */
const findOpen = findOpenLfgBornSessionGroup as jest.MockedFunction<
  typeof findOpenLfgBornSessionGroup
>;
const convertHolder = convertJoinerHand as jest.MockedFunction<
  typeof convertJoinerHand
>;
const moved = (converted: number, cleared: number[] = []) => ({
  converted,
  clearedSiblingUserIds: cleared,
});

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
  convertHolder.mockReset().mockResolvedValue(moved(1));
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
    db.limit.mockResolvedValueOnce([{ gameId: 99 }]).mockResolvedValueOnce([]);

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
    findOpen.mockResolvedValue('');
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // event lookup
      .mockResolvedValueOnce([{ id: 5 }]); // live intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(findOpen).toHaveBeenCalledWith(db, 99, 42);
    expect(convertHolder).toHaveBeenCalledTimes(1);
    expect(convertHolder).toHaveBeenCalledWith(db, 99, 7, 42, '');
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
    findOpen.mockResolvedValue('');
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }]) // event lookup
      .mockResolvedValueOnce([]); // no live intent

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(findOpen).not.toHaveBeenCalled();
    expect(convertHolder).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('is a safe no-op when the joiner already converted (AC4)', async () => {
    findOpen.mockResolvedValue('');
    convertHolder.mockResolvedValue(moved(0));
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([{ id: 5 }]);

    await expect(
      listener.onParticipantJoined({ eventId: 42, userId: 7 }),
    ).resolves.toBeUndefined();
    expect(convertHolder).toHaveBeenCalledWith(db, 99, 7, 42, '');
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('LfgQuickPlayListener — ROK-2352 P1-1 group-scoped voice join', () => {
  it("converts only the session group's hand and names that group", async () => {
    // MUTATION: convert every live hand of the game (the old
    // convertHolderIntent call) and the 5th argument 'dungeon:36' is missing.
    const { db, emitter, listener } = harness();
    findOpen.mockResolvedValue('dungeon:36');
    convertHolder.mockResolvedValue(moved(1, [7]));
    db.limit
      .mockResolvedValueOnce([{ gameId: 99 }])
      .mockResolvedValueOnce([{ id: 5 }]);

    await listener.onParticipantJoined({ eventId: 42, userId: 7 });

    expect(convertHolder).toHaveBeenCalledWith(db, 99, 7, 42, 'dungeon:36');
    expect(emitter.emit).toHaveBeenNthCalledWith(1, LFG_EVENTS.GROUP_CHANGED, {
      gameId: 99,
      reason: 'playing',
      eventId: 42,
      groupKey: 'dungeon:36',
    });
    expect(emitter.emit).toHaveBeenNthCalledWith(2, LFG_EVENTS.GROUP_CHANGED, {
      gameId: 99,
      reason: 'withdrawn',
      userIds: [7],
    });
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
    findOpen.mockResolvedValue(null); // session 77 is open; 42 is not LFG-born
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
    findOpen.mockResolvedValue('');
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
    findOpen.mockResolvedValue('');

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
