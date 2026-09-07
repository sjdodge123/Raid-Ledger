/**
 * ROK-1457 — LineupLfgBridgeService branching.
 *
 * The selector is a real-DB concern (integration spec); here it is mocked and
 * the service's own rules are pinned: one notification per user, in-app only
 * (`skipDiscord: true`), dedup key per (user, game) with the 30-day TTL,
 * fail-CLOSED when the guard is down, claims released on a rejected create,
 * and a handler that never rejects.
 */
import { LineupLfgBridgeService } from './lineup-lfg-bridge.service';
import { LINEUP_EVENTS } from '../lineups/lineup-events.constants';
import {
  LFG_BRIDGE_DEDUP_TTL_SECONDS,
  type BridgeCandidate,
} from '../lfg/lfg-bridge.helpers';

jest.mock('../lfg/lfg-bridge.helpers', () => ({
  ...jest.requireActual('../lfg/lfg-bridge.helpers'),
  findBridgeCandidates: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helpers = require('../lfg/lfg-bridge.helpers') as {
  findBridgeCandidates: jest.Mock;
};

function candidate(userId: number, gameId: number): BridgeCandidate {
  return {
    userId,
    gameId,
    gameName: `Game ${gameId}`,
    gameSlug: `game-${gameId}`,
    gameCoverUrl: null,
    lineupId: 42,
    lineupTitle: 'Friday Night',
  };
}

interface Harness {
  service: LineupLfgBridgeService;
  create: jest.Mock;
  checkAndMarkSent: jest.Mock;
  releaseKey: jest.Mock;
  errorLog: jest.SpyInstance;
}

function makeService(opts: {
  candidates?: BridgeCandidate[] | Error;
  /** Keys the guard reports as already sent. */
  alreadySent?: string[];
  dedupThrows?: boolean;
  createRejectsFor?: number[];
}): Harness {
  if (opts.candidates instanceof Error) {
    helpers.findBridgeCandidates.mockRejectedValue(opts.candidates);
  } else {
    helpers.findBridgeCandidates.mockResolvedValue(opts.candidates ?? []);
  }
  const sent = new Set(opts.alreadySent ?? []);
  const checkAndMarkSent = opts.dedupThrows
    ? jest.fn().mockRejectedValue(new Error('Redis is down'))
    : jest.fn((key: string) => Promise.resolve(sent.has(key)));
  const releaseKey = jest.fn().mockResolvedValue(undefined);
  const rejectFor = new Set(opts.createRejectsFor ?? []);
  const create = jest.fn((body: { userId: number }) =>
    rejectFor.has(body.userId)
      ? Promise.reject(new Error('insert failed'))
      : Promise.resolve({ id: 'n1' }),
  );
  const service = new LineupLfgBridgeService(
    {} as never,
    { create } as never,
    { checkAndMarkSent, releaseKey } as never,
  );
  const logger = (service as unknown as { logger: Record<string, () => void> })
    .logger;
  const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'log').mockImplementation(() => {});
  return { service, create, checkAndMarkSent, releaseKey, errorLog };
}

/** Event names the class registers via `@OnEvent`, read back off the metadata. */
function registeredEvents(): string[] {
  const proto = LineupLfgBridgeService.prototype as unknown as Record<
    string,
    unknown
  >;
  const events: string[] = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    const method = proto[key];
    if (typeof method !== 'function') continue;
    const meta: unknown = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      method,
    );
    const entries = Array.isArray(meta) ? meta : meta ? [meta] : [];
    for (const entry of entries) {
      const event = (entry as { event?: string }).event;
      if (event) events.push(event);
    }
  }
  return events;
}

describe('LineupLfgBridgeService (ROK-1457)', () => {
  const payload = { lineupId: 42 };

  afterEach(() => jest.restoreAllMocks());

  it('listens to LINEUP_EVENTS.DECIDED and nothing else', () => {
    expect(registeredEvents()).toEqual([LINEUP_EVENTS.DECIDED]);
  });

  it('batches per user: 3 losing games for one user → ONE in-app create, no Discord (AC6, D3)', async () => {
    const h = makeService({
      candidates: [candidate(7, 1), candidate(7, 2), candidate(7, 3)],
    });

    await h.service.handleLineupDecided(payload);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        type: 'community_lineup',
        skipDiscord: true,
        payload: expect.objectContaining({
          lineupId: 42,
          link: '/lineups/42',
          games: expect.arrayContaining([
            expect.objectContaining({ gameId: 3 }),
          ]),
        }),
      }),
    );
    expect(h.create.mock.calls[0][0].payload.games).toHaveLength(3);
  });

  it('claims per (user, game) with the 30-day TTL BEFORE dispatching (D2)', async () => {
    const h = makeService({ candidates: [candidate(7, 1), candidate(9, 1)] });

    await h.service.handleLineupDecided(payload);

    expect(h.checkAndMarkSent.mock.calls).toEqual([
      ['lfg-bridge:user:7:game:1', LFG_BRIDGE_DEDUP_TTL_SECONDS],
      ['lfg-bridge:user:9:game:1', LFG_BRIDGE_DEDUP_TTL_SECONDS],
    ]);
    expect(h.checkAndMarkSent.mock.invocationCallOrder[1]).toBeLessThan(
      h.create.mock.invocationCallOrder[0],
    );
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it('names only the NEWLY claimed games; a fully-claimed user gets nothing (AC4)', async () => {
    const h = makeService({
      candidates: [candidate(7, 1), candidate(7, 2), candidate(9, 5)],
      alreadySent: ['lfg-bridge:user:7:game:1', 'lfg-bridge:user:9:game:5'],
    });

    await h.service.handleLineupDecided(payload);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].userId).toBe(7);
    expect(h.create.mock.calls[0][0].payload.games).toEqual([
      { gameId: 2, gameName: 'Game 2', gameSlug: 'game-2' },
    ]);
  });

  it('fails CLOSED: a dedup outage drops the whole wave', async () => {
    const h = makeService({
      candidates: [candidate(7, 1), candidate(9, 1)],
      dedupThrows: true,
    });

    await h.service.handleLineupDecided(payload);

    expect(h.create).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalledWith(
      expect.stringContaining('dropping the wave'),
      expect.anything(),
    );
  });

  it('releases every claim of a user whose create rejected, and only theirs', async () => {
    const h = makeService({
      candidates: [candidate(7, 1), candidate(7, 2), candidate(9, 3)],
      createRejectsFor: [7],
    });

    await h.service.handleLineupDecided(payload);

    expect(h.releaseKey.mock.calls.map((c) => c[0]).sort()).toEqual([
      'lfg-bridge:user:7:game:1',
      'lfg-bridge:user:7:game:2',
    ]);
  });

  it('does nothing when there are no candidates', async () => {
    const h = makeService({ candidates: [] });
    await h.service.handleLineupDecided(payload);
    expect(h.checkAndMarkSent).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('never rejects — a selector failure is logged, not thrown', async () => {
    const h = makeService({ candidates: new Error('db exploded') });
    await expect(
      h.service.handleLineupDecided(payload),
    ).resolves.toBeUndefined();
    expect(h.errorLog).toHaveBeenCalledWith(
      expect.stringContaining('db exploded'),
      expect.anything(),
    );
    expect(h.create).not.toHaveBeenCalled();
  });
});
