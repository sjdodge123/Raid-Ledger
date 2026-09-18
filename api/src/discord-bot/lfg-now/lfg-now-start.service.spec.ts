/**
 * Unit specs for `LfgNowSpawnService.startNow` — the `POST /lfg/:gameId/start-now`
 * body (ROK-1613 AC1/AC4/AC5/AC6).
 *
 * The spawn transaction itself is covered by `lfg-now-manual-start.helpers.spec`
 * and mocked here: what is under test is the endpoint's contract — who is
 * refused, what the manual options carry, and that the invites are dispatched
 * OUTSIDE the transaction with the list the spawn returned.
 */
import { ForbiddenException } from '@nestjs/common';
import { LfgNowSpawnService } from './lfg-now-spawn.service';
import { spawnUnderGroupLock } from './lfg-now-spawn.helpers';
import { dispatchLiveSessionInvites } from './lfg-now-invite.helpers';
import { holdsLiveIntent } from '../../lfg/lfg-invite.helpers';
import { LFG_NOW_START_NEEDS_INTENT } from './lfg-now.constants';
import { LFG_EVENTS } from '../../lfg/lfg.constants';

jest.mock('./lfg-now-spawn.helpers', () => ({
  spawnUnderGroupLock: jest.fn(),
}));
jest.mock('./lfg-now-invite.helpers', () => ({
  dispatchLiveSessionInvites: jest.fn(),
}));
jest.mock('../../lfg/lfg-invite.helpers', () => ({
  holdsLiveIntent: jest.fn(),
}));

const spawn = spawnUnderGroupLock as jest.MockedFunction<
  typeof spawnUnderGroupLock
>;
const dispatch = dispatchLiveSessionInvites as jest.MockedFunction<
  typeof dispatchLiveSessionInvites
>;
const participant = holdsLiveIntent as jest.MockedFunction<
  typeof holdsLiveIntent
>;

const GAME_ID = 42;
const STARTER_ID = 7;

function makeService(): {
  service: LfgNowSpawnService;
  emit: jest.Mock;
  create: jest.Mock;
} {
  const emit = jest.fn();
  const create = jest.fn().mockResolvedValue(undefined);
  const service = new LfgNowSpawnService(
    {} as never,
    { emit } as never,
    null,
    { get: jest.fn().mockResolvedValue(null) } as never,
    { create } as never,
  );
  return { service, emit, create };
}

beforeEach(() => {
  jest.clearAllMocks();
  participant.mockResolvedValue(true);
  dispatch.mockResolvedValue(2);
  spawn.mockResolvedValue({
    eventId: 900,
    spawned: true,
    invitedUserIds: [8, 9],
  });
});

describe('LfgNowSpawnService.startNow', () => {
  it('refuses a caller with no live hand, in the poll action’s words (AC6)', async () => {
    // MUTATION: drop the `holdsLiveIntent` check and a stranger starts
    // somebody else's group.
    participant.mockResolvedValue(false);
    const { service } = makeService();

    await expect(service.startNow(STARTER_ID, GAME_ID)).rejects.toThrow(
      new ForbiddenException(LFG_NOW_START_NEEDS_INTENT),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('passes the caller as the manual starter, never a now-hand (finding 2)', async () => {
    // MUTATION: omit `opts.manual` and the threshold guard silently applies
    // again — a lone week-hander's press does nothing.
    const { service } = makeService();

    const result = await service.startNow(STARTER_ID, GAME_ID);

    expect(result).toEqual({ eventId: 900, spawned: true, invited: 2 });
    expect(spawn).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      expect.any(Date),
      { manual: { starterUserId: STARTER_ID } },
    );
  });

  it('dispatches the invites the spawn returned, after it resolved (AC4)', async () => {
    // MUTATION: invite from inside the transaction and this list is announced
    // even when the spawn rolls back.
    const { service } = makeService();

    await service.startNow(STARTER_ID, GAME_ID);

    // `clientUrl` is resolved from settings/env and is not what this asserts.
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        gameId: GAME_ID,
        starterUserId: STARTER_ID,
        userIds: [8, 9],
      }),
    );
    // Post-COMMIT ordering: the spawn's promise settles before the first DM.
    expect(spawn.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0],
    );
  });

  it('still reports the session when every invite fails', async () => {
    // MUTATION: let the dispatch rejection escape and a live session reports
    // as a 500 to the starter who is already on its roster.
    dispatch.mockRejectedValue(new Error('DM down'));
    const { service } = makeService();

    await expect(service.startNow(STARTER_ID, GAME_ID)).resolves.toEqual({
      eventId: 900,
      spawned: true,
      invited: 0,
    });
  });

  it('reports an ATTACH as spawned:false rather than an error (AC5)', async () => {
    // MUTATION: throw on `spawned === false` and a second press 409s instead of
    // joining the session that is already live.
    spawn.mockResolvedValue({
      eventId: 555,
      spawned: false,
      invitedUserIds: [],
    });
    const { service, emit } = makeService();

    const result = await service.startNow(STARTER_ID, GAME_ID);

    expect(result).toEqual({ eventId: 555, spawned: false, invited: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME_ID,
      reason: 'playing',
      eventId: 555,
    });
  });
});
