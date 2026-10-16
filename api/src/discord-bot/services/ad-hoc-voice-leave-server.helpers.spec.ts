/**
 * ROK-1821 (RCA missing test 2) — a voice leave that empties the channel
 * starts no grace while anyone is on the game server: an open on-server row,
 * or a player the tracker reports (answered through SERVER_TRACKER_ENROL).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { startGracePeriod } from './ad-hoc-event.handlers';
import { hasOpenServerPlayers } from './ad-hoc-server-presence.helpers';
import {
  graceUnlessOnServer,
  SERVER_TRACKER_ENROL,
} from './ad-hoc-voice-leave-server.helpers';

jest.mock('./ad-hoc-event.handlers', () => ({ startGracePeriod: jest.fn() }));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  hasOpenServerPlayers: jest.fn(),
}));

type GraceDeps = Parameters<typeof graceUnlessOnServer>[0];
const DEPS = {
  db: {} as PostgresJsDatabase<typeof schema>,
} as unknown as GraceDeps;
const EV = { eventId: 278, gameId: 10, bindingId: 'b1' };

function emitterAnswering(answers: unknown[] | Error) {
  const emitAsync = jest.fn(() =>
    answers instanceof Error
      ? Promise.reject(answers)
      : Promise.resolve(answers),
  );
  return { emitAsync } as unknown as Parameters<typeof graceUnlessOnServer>[1];
}

afterEach(() => jest.resetAllMocks());

describe('graceUnlessOnServer (ROK-1821)', () => {
  it('a voice leave while the player is still open on the server starts no grace', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(true);
    const emitter = emitterAnswering([]);
    await graceUnlessOnServer(DEPS, emitter, EV);
    expect(startGracePeriod).not.toHaveBeenCalled();
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('a player the tracker reports keeps the event out of grace, with no open row', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(false);
    const emitter = emitterAnswering([true]);
    await graceUnlessOnServer(DEPS, emitter, EV);
    expect(emitter.emitAsync).toHaveBeenCalledWith(SERVER_TRACKER_ENROL, {
      eventId: 278,
      gameId: 10,
    });
    expect(startGracePeriod).not.toHaveBeenCalled();
  });

  it('starts grace when neither rows nor the tracker report anyone', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(false);
    await graceUnlessOnServer(DEPS, emitterAnswering([false]), EV);
    expect(startGracePeriod).toHaveBeenCalledWith(DEPS, 278, 'b1');
  });

  it('starts grace when the tracker check throws (never blocks a voice leave)', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(false);
    await graceUnlessOnServer(DEPS, emitterAnswering(new Error('x')), EV);
    expect(startGracePeriod).toHaveBeenCalledWith(DEPS, 278, 'b1');
  });

  it('a gameless event skips the tracker and starts grace', async () => {
    jest.mocked(hasOpenServerPlayers).mockResolvedValue(false);
    const emitter = emitterAnswering([true]);
    await graceUnlessOnServer(DEPS, emitter, { ...EV, gameId: null });
    expect(emitter.emitAsync).not.toHaveBeenCalled();
    expect(startGracePeriod).toHaveBeenCalledWith(DEPS, 278, 'b1');
  });
});
