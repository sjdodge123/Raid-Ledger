/**
 * ROK-1800 x ROK-1801 merge — `joinPending`'s order: the ROK-959 suppression
 * guard runs FIRST (ROK-1800), then the spawn gate sums held server players
 * and voice people (`held + voice < min`, ROK-1801 Q9).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { AdHocServerPresenceService } from './ad-hoc-server-presence.service';
import type { ServerPathVoiceTally } from './ad-hoc-server-voice-tally.service';
import { checkSuppression } from './ad-hoc-spawn-clearance';
import {
  findGameVoiceBinding,
  findLiveGameAdHocEvent,
} from './ad-hoc-server-presence.helpers';
import { buildServerSpawnInput } from './ad-hoc-server-spawn.helpers';

jest.mock('./ad-hoc-spawn-clearance', () => ({ checkSuppression: jest.fn() }));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-presence.helpers'),
  findGameVoiceBinding: jest.fn(),
  findLiveGameAdHocEvent: jest.fn(),
}));
jest.mock('./ad-hoc-server-spawn.helpers', () => ({
  ...jest.requireActual<object>('./ad-hoc-server-spawn.helpers'),
  buildServerSpawnInput: jest.fn(),
}));

const SOURCE: ServerPresenceSource = { gameId: 10, pelicanServerId: 1 };
const PLAYER = {
  steamId: '76561198000000001',
  displayName: null,
} as unknown as ServerPresencePlayer;
const CLEARANCE = { matches: () => true, consume: () => true };

function serviceWith(voice: number): {
  svc: AdHocServerPresenceService;
  countFor: jest.Mock;
} {
  const countFor = jest.fn().mockResolvedValue(voice);
  const tally = { countFor } as unknown as ServerPathVoiceTally;
  const deps = [
    {} as PostgresJsDatabase<typeof schema>,
    { isEnabled: () => Promise.resolve(true) },
    {},
    {},
    {},
    {},
    {},
    { emit: jest.fn() },
    tally,
  ] as unknown as ConstructorParameters<typeof AdHocServerPresenceService>;
  return { svc: new AdHocServerPresenceService(...deps), countFor };
}

beforeEach(() => {
  jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(null);
  jest.mocked(findGameVoiceBinding).mockResolvedValue({
    id: 'b1',
    config: { minPlayers: 2 },
  });
  jest.mocked(buildServerSpawnInput).mockResolvedValue(null);
});

afterEach(() => jest.resetAllMocks());

describe('AdHocServerPresenceService.joinPending — merge order', () => {
  it('a suppressed game never spawns, however many people are in voice', async () => {
    jest.mocked(checkSuppression).mockResolvedValue(null);
    const { svc, countFor } = serviceWith(9);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(checkSuppression).toHaveBeenCalledTimes(1);
    expect(countFor).not.toHaveBeenCalled();
    expect(buildServerSpawnInput).not.toHaveBeenCalled();
  });

  it('spawns when 1 held server player + 1 voice person reach minPlayers 2', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(1);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(buildServerSpawnInput).toHaveBeenCalledTimes(1);
  });

  it('holds when 1 server player + 0 voice is under minPlayers 2', async () => {
    jest
      .mocked(checkSuppression)
      .mockResolvedValue(
        CLEARANCE as unknown as Awaited<ReturnType<typeof checkSuppression>>,
      );
    const { svc } = serviceWith(0);
    await svc.playerJoined(SOURCE, PLAYER);
    expect(buildServerSpawnInput).not.toHaveBeenCalled();
  });
});
