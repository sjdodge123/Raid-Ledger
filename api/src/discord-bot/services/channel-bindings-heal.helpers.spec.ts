/**
 * ROK-1389 Part 3 — WARN-only binding health reporter.
 *
 * Verifies it logs the two failure shapes (pre-1372 residue, rotted recurrence
 * group) and — critically — never mutates: insert/update/delete are asserted
 * unused. The rejected auto-repair variant is why this must stay read-only.
 */
import {
  reportBindingHealthWarnings,
  type HealBinding,
} from './channel-bindings-heal.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

function makeLogger() {
  return { warn: jest.fn() };
}

/** Residue-shaped series voice binding (game-voice-monitor + gameId). */
const RESIDUE: HealBinding = {
  channelId: 'voice-residue',
  channelType: 'voice',
  bindingPurpose: 'game-voice-monitor',
  gameId: 7,
  recurrenceGroupId: 'group-residue',
};

/** Healthy series voice binding (general-lobby, follows this week's game). */
const GENERAL_LOBBY: HealBinding = {
  channelId: 'voice-lobby',
  channelType: 'voice',
  bindingPurpose: 'general-lobby',
  gameId: null,
  recurrenceGroupId: 'group-lobby',
};

describe('reportBindingHealthWarnings (ROK-1389 Part 3)', () => {
  let mockDb: MockDb;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    logger = makeLogger();
  });

  it('WARNs a pre-ROK-1372 residue-shaped series voice binding', async () => {
    // Group is live (has a future event) so ONLY the residue warning fires.
    mockDb.where.mockResolvedValue([{ recurrenceGroupId: 'group-residue' }]);

    await reportBindingHealthWarnings(mockDb as never, [RESIDUE], logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('pre-ROK-1372');
    expect(logger.warn.mock.calls[0][0]).toContain('channel=voice-residue');
  });

  it('WARNs a series binding whose recurrence group has no future event (rot)', async () => {
    // general-lobby is not residue; the empty live-group set makes it rotted.
    mockDb.where.mockResolvedValue([]);

    await reportBindingHealthWarnings(mockDb as never, [GENERAL_LOBBY], logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('binding rot');
    expect(logger.warn.mock.calls[0][0]).toContain('channel=voice-lobby');
  });

  it('stays silent for a healthy, live general-lobby series binding', async () => {
    mockDb.where.mockResolvedValue([{ recurrenceGroupId: 'group-lobby' }]);

    await reportBindingHealthWarnings(mockDb as never, [GENERAL_LOBBY], logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never mutates the database (read-only)', async () => {
    mockDb.where.mockResolvedValue([{ recurrenceGroupId: 'group-residue' }]);

    await reportBindingHealthWarnings(
      mockDb as never,
      [RESIDUE, GENERAL_LOBBY],
      logger,
    );

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('short-circuits (no query) when no binding carries a recurrence group', async () => {
    const gameOnly: HealBinding = {
      channelId: 'voice-game',
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: 3,
      recurrenceGroupId: null,
    };

    await reportBindingHealthWarnings(mockDb as never, [gameOnly], logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
