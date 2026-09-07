/**
 * ROK-1456 — `ensureNotSuppressed` + the `SpawnClearance` receipt.
 *
 * The ROK-959 guard (find a live scheduled event; bound-extend its
 * `extended_until`) must run exactly once per spawn-path join. The listener
 * runs it and hands the receipt to `handleVoiceJoin`; the service honours the
 * receipt only when it matches `(binding, game)` and is unspent, and otherwise
 * owns the guard itself — so nothing a caller passes can skip it.
 */
import {
  baseMember,
  baseBinding,
  setupAdHocTestModule,
  type AdHocMocks,
} from './ad-hoc-event.service.spec-helpers';
import type { AdHocEventService } from './ad-hoc-event.service';
import * as helpers from './ad-hoc-event.helpers';

const CHANNEL = 'voice-channel-shared';
const BINDING_A = { ...baseBinding, gameId: 10 };

describe('AdHocEventService — ensureNotSuppressed / SpawnClearance (ROK-1456)', () => {
  let service: AdHocEventService;
  let mocks: AdHocMocks;
  let findSpy: jest.SpyInstance;

  beforeEach(async () => {
    const setup = await setupAdHocTestModule();
    service = setup.service;
    mocks = setup.mocks;
    mocks.settingsService.get.mockResolvedValue('true');
    findSpy = jest.spyOn(helpers, 'findActiveScheduledEvent');
  });

  afterEach(() => {
    findSpy.mockRestore();
    jest.clearAllMocks();
  });

  /** Queue the DB responses a fresh spawn consumes (guard is spied, not queued). */
  function mockSpawn(id: number, bindingId: string, gameName: string) {
    mocks.db.limit.mockResolvedValueOnce([{ name: gameName }]);
    mocks.db.returning.mockResolvedValueOnce([{ id }]);
    mocks.db.limit.mockResolvedValueOnce([
      {
        id,
        title: `${gameName} — Quick Play`,
        gameId: 10,
        channelBindingId: bindingId,
      },
    ]);
    mocks.db.limit.mockResolvedValueOnce([{ name: gameName }]);
  }

  function liveScheduledEvent() {
    return {
      id: 42,
      extendedUntil: null,
      scheduledEnd: new Date(Date.now() + 2 * 60 * 60_000),
      matchedBy: 'game',
    } as never;
  }

  it('returns null and extends extended_until when a scheduled event is live (ROK-959)', async () => {
    findSpy.mockResolvedValueOnce(liveScheduledEvent());
    mocks.db.returning.mockResolvedValueOnce([{ id: 42 }]);

    const result = await service.ensureNotSuppressed('binding-A', 10, CHANNEL);

    expect(result).toBeNull();
    expect(mocks.db.update).toHaveBeenCalled();
    expect(mocks.db.set).toHaveBeenCalledWith(
      expect.objectContaining({ extendedUntil: expect.any(Date) }),
    );
  });

  it('returns a clearance bound to (binding, game, channel) when nothing is live', async () => {
    findSpy.mockResolvedValue(null);

    const result = await service.ensureNotSuppressed('binding-A', 10, CHANNEL);

    expect(result).not.toBeNull();
    expect(result!.matches('binding-A', 10)).toBe(true);
    expect(result!.matches('binding-B', 10)).toBe(false);
    expect(result!.matches('binding-A', 11)).toBe(false);
    expect(result!.channelId).toBe(CHANNEL);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(
      expect.anything(),
      'binding-A',
      10,
      expect.any(Date),
      CHANNEL,
    );
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it('REGRESSION: handleVoiceJoin with a matching clearance spawns WITHOUT re-running the suppression query', async () => {
    findSpy.mockResolvedValue(null);
    const clearance = await service.ensureNotSuppressed(
      'binding-A',
      10,
      CHANNEL,
    );
    expect(findSpy).toHaveBeenCalledTimes(1);
    mockSpawn(1, 'binding-A', 'Game');

    const handled = await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
      clearance!,
    );

    expect(handled).toBe(true);
    expect(mocks.db.insert).toHaveBeenCalled();
    // The dedupe: the listener's guard run is the ONLY run for this spawn.
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it('handleVoiceJoin without a clearance still runs the guard itself', async () => {
    findSpy.mockResolvedValue(null);
    mockSpawn(2, 'binding-A', 'Game');

    const handled = await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
    );

    expect(handled).toBe(true);
    expect(mocks.db.insert).toHaveBeenCalled();
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(
      expect.anything(),
      'binding-A',
      10,
      expect.any(Date),
      CHANNEL,
    );
  });

  it('ignores a mismatched clearance and re-runs the guard (a foreign receipt cannot bypass ROK-959)', async () => {
    findSpy.mockResolvedValue(null);
    const foreign = await service.ensureNotSuppressed('binding-A', 10, CHANNEL);
    findSpy.mockClear();
    findSpy.mockResolvedValueOnce(liveScheduledEvent());
    mocks.db.returning.mockResolvedValueOnce([{ id: 42 }]);

    const handled = await service.handleVoiceJoin(
      'binding-B',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
      foreign!,
    );

    expect(handled).toBe(false);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(
      expect.anything(),
      'binding-B',
      10,
      expect.any(Date),
      CHANNEL,
    );
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it('ignores a consumed clearance and re-runs the guard (a receipt is single-use)', async () => {
    findSpy.mockResolvedValue(null);
    const clearance = await service.ensureNotSuppressed(
      'binding-A',
      10,
      CHANNEL,
    );
    mockSpawn(3, 'binding-A', 'Game');
    await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
      clearance!,
    );
    expect(findSpy).toHaveBeenCalledTimes(1);
    // Cancel the spawned event so the next join reaches the spawn path again.
    await service.onEventCancelled({ eventId: 3 });
    expect(service.getActiveState('binding-A', 10)).toBeUndefined();
    findSpy.mockClear();
    findSpy.mockResolvedValueOnce(liveScheduledEvent());
    mocks.db.returning.mockResolvedValueOnce([{ id: 42 }]);

    const handled = await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
      clearance!,
    );

    expect(handled).toBe(false);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it('a suppressed join with no clearance returns false and never inserts', async () => {
    findSpy.mockResolvedValueOnce(liveScheduledEvent());
    mocks.db.returning.mockResolvedValueOnce([{ id: 42 }]);

    const handled = await service.handleVoiceJoin(
      'binding-A',
      baseMember,
      BINDING_A,
      undefined,
      undefined,
      CHANNEL,
    );

    expect(handled).toBe(false);
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.participantService.addParticipant).not.toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalled();
  });
});
