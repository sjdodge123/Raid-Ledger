/**
 * ROK-1632 AC3 — the "everyone picked this time" creator DM service.
 *
 * Unit tier: every dependency is mocked, so the rules under test are the
 * service's own — claim BEFORE the send, release the claim only when the send
 * THREW, never surface an error to the voter, and resolve the timezone once
 * per sweep. The query itself is Lane A's and is covered by
 * `scheduling-unanimous.helpers.spec.ts`.
 */
import { Logger } from '@nestjs/common';
import { SchedulingUnanimousService } from './scheduling-unanimous.service';
import {
  UNANIMOUS_SUBTYPE,
  unanimousDedupKey,
  type UnanimousSlotRow,
} from './scheduling-unanimous.helpers';

const ROW: UnanimousSlotRow = {
  matchId: 42,
  slotId: 9,
  lineupId: 7,
  creatorId: 3,
  gameName: 'Deep Rock Galactic',
  proposedTime: '2026-10-01T19:00:00.000Z',
  memberCount: 4,
};

const OTHER_ROW: UnanimousSlotRow = { ...ROW, slotId: 10, memberCount: 4 };

interface Mocks {
  db: { execute: jest.Mock };
  notifications: { create: jest.Mock };
  dedup: { checkAndMarkSent: jest.Mock; releaseKey: jest.Mock };
  settings: { getDefaultTimezone: jest.Mock };
  cron: { executeWithTracking: jest.Mock };
}

/** Build the service with fully mocked deps; rows are what the query returns. */
function build(rows: UnanimousSlotRow[] = [ROW]): {
  service: SchedulingUnanimousService;
  m: Mocks;
} {
  const m: Mocks = {
    db: { execute: jest.fn().mockResolvedValue(rows) },
    notifications: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    dedup: {
      checkAndMarkSent: jest.fn().mockResolvedValue(false),
      releaseKey: jest.fn().mockResolvedValue(undefined),
    },
    settings: { getDefaultTimezone: jest.fn().mockResolvedValue('UTC') },
    cron: {
      executeWithTracking: jest
        .fn()
        .mockImplementation(async (_name: string, fn: () => Promise<unknown>) =>
          fn(),
        ),
    },
  };
  const service = new SchedulingUnanimousService(
    m.db as never,
    m.notifications as never,
    m.dedup as never,
    m.settings as never,
    m.cron as never,
  );
  return { service, m };
}

describe('SchedulingUnanimousService.checkMatch (ROK-1632 AC3)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends one DM to the creator for a unanimous slot', async () => {
    const { service, m } = build();
    const sent = await service.checkMatch(42);
    expect(sent).toBe(1);
    expect(m.notifications.create).toHaveBeenCalledTimes(1);
    const input = m.notifications.create.mock.calls[0][0];
    expect(input.userId).toBe(ROW.creatorId);
    expect(input.type).toBe('community_lineup');
    expect(input.payload.subtype).toBe(UNANIMOUS_SUBTYPE);
    expect(input.payload.slotId).toBe(ROW.slotId);
  });

  it('claims a PERMANENT dedup key BEFORE the send', async () => {
    const { service, m } = build();
    const order: string[] = [];
    m.dedup.checkAndMarkSent.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(false);
    });
    m.notifications.create.mockImplementation(() => {
      order.push('send');
      return Promise.resolve({ id: 1 });
    });
    await service.checkMatch(42);
    expect(order).toEqual(['claim', 'send']);
    expect(m.dedup.checkAndMarkSent).toHaveBeenCalledWith(
      unanimousDedupKey(42, 9),
      null,
    );
  });

  it('sends nothing when the claim is already held (un-vote/re-vote)', async () => {
    const { service, m } = build();
    m.dedup.checkAndMarkSent.mockResolvedValue(true);
    const sent = await service.checkMatch(42);
    expect(sent).toBe(0);
    expect(m.notifications.create).not.toHaveBeenCalled();
    expect(m.dedup.releaseKey).not.toHaveBeenCalled();
  });

  it('releases the claim when the send THROWS, so the next tick retries', async () => {
    const { service, m } = build();
    m.notifications.create.mockRejectedValue(new Error('discord down'));
    const sent = await service.checkMatch(42);
    expect(sent).toBe(0);
    expect(m.dedup.releaseKey).toHaveBeenCalledWith(unanimousDedupKey(42, 9));
  });

  it('KEEPS the claim when create resolves null (prefs suppressed)', async () => {
    const { service, m } = build();
    m.notifications.create.mockResolvedValue(null);
    const sent = await service.checkMatch(42);
    expect(sent).toBe(1);
    expect(m.dedup.releaseKey).not.toHaveBeenCalled();
  });

  it('never throws at the caller when the send fails (the voter is untouched)', async () => {
    const { service, m } = build();
    m.notifications.create.mockRejectedValue(new Error('discord down'));
    await expect(service.checkMatch(42)).resolves.toBe(0);
  });

  it('never throws at the caller when the query fails', async () => {
    const { service, m } = build();
    m.db.execute.mockRejectedValue(new Error('relation does not exist'));
    await expect(service.checkMatch(42)).resolves.toBe(0);
    expect(m.notifications.create).not.toHaveBeenCalled();
  });

  it('isolates a failing row so the next slot still gets its DM', async () => {
    const { service, m } = build([ROW, OTHER_ROW]);
    m.notifications.create
      .mockRejectedValueOnce(new Error('discord down'))
      .mockResolvedValueOnce({ id: 2 });
    const sent = await service.checkMatch(42);
    expect(sent).toBe(1);
    expect(m.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('sends one DM per unanimous time (two slots → two DMs)', async () => {
    const { service, m } = build([ROW, OTHER_ROW]);
    const sent = await service.checkMatch(42);
    expect(sent).toBe(2);
    expect(m.dedup.checkAndMarkSent.mock.calls.map((c) => c[0])).toEqual([
      unanimousDedupKey(42, 9),
      unanimousDedupKey(42, 10),
    ]);
  });

  it('resolves the timezone once per sweep, not once per row', async () => {
    const { service, m } = build([ROW, OTHER_ROW]);
    await service.checkMatch(42);
    expect(m.settings.getDefaultTimezone).toHaveBeenCalledTimes(1);
  });

  it('does not touch settings when no slot is unanimous', async () => {
    const { service, m } = build([]);
    const sent = await service.checkMatch(42);
    expect(sent).toBe(0);
    expect(m.settings.getDefaultTimezone).not.toHaveBeenCalled();
  });
});

describe('SchedulingUnanimousService.handleSweep (ROK-1632 AC3)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sweeps EVERY open match (matchId null) through cron tracking', async () => {
    const { service, m } = build();
    const check = jest.spyOn(service, 'checkMatch');
    await service.handleSweep();
    expect(m.cron.executeWithTracking).toHaveBeenCalledTimes(1);
    expect(m.cron.executeWithTracking.mock.calls[0][0]).toBe(
      'SchedulingUnanimousService_sweep',
    );
    expect(check).toHaveBeenCalledWith(null);
  });

  it('reports an idle tick as false so no execution row is recorded', async () => {
    const { service, m } = build([]);
    let tracked: unknown;
    m.cron.executeWithTracking.mockImplementation(
      async (_n: string, fn: () => Promise<unknown>) => {
        tracked = await fn();
      },
    );
    await service.handleSweep();
    expect(tracked).toBe(false);
  });
});
