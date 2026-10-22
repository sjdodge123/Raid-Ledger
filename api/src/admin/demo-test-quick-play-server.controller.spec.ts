/**
 * DemoTestQuickPlayServerController — the DEMO_MODE unlinked server-player seam
 * (ROK-1888). Pinned: the gate, the unlinked-only and attach-only refusals, and
 * that a valid join goes through the real presence sink with the game's source.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as presenceHelpers from '../discord-bot/services/ad-hoc-server-presence.helpers';
import {
  DEMO_PELICAN_SERVER_ID,
  DemoTestQuickPlayServerController,
} from './demo-test-quick-play-server.controller';

const STEAM = '76561198000000001';
const settings = { getDemoMode: jest.fn() };
const adHoc = { isEnabled: jest.fn() };
const presence = { playerJoined: jest.fn() };
const body = { gameId: 4, steamId: STEAM, displayName: 'Loanati' };
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

function controller(): DemoTestQuickPlayServerController {
  return new DemoTestQuickPlayServerController(
    {} as never,
    settings as never,
    adHoc as never,
    presence as never,
  );
}

let liveSpy: jest.SpyInstance;
let identitySpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEMO_MODE = 'true';
  settings.getDemoMode.mockResolvedValue(true);
  adHoc.isEnabled.mockResolvedValue(true);
  presence.playerJoined.mockResolvedValue(undefined);
  liveSpy = jest
    .spyOn(presenceHelpers, 'findLiveGameAdHocEvent')
    .mockResolvedValue({
      id: 55,
      channelBindingId: 'b-1',
      adHocStatus: 'live',
    });
  identitySpy = jest
    .spyOn(presenceHelpers, 'resolveSteamIdentity')
    .mockResolvedValue(null);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('DemoTestQuickPlayServerController.serverJoin', () => {
  it('attaches the unlinked player through the presence sink', async () => {
    await expect(controller().serverJoin(body)).resolves.toEqual({
      eventId: 55,
    });
    expect(liveSpy).toHaveBeenCalledWith({}, 4);
    expect(presence.playerJoined).toHaveBeenCalledWith(
      { pelicanServerId: DEMO_PELICAN_SERVER_ID, gameId: 4 },
      { steamId: STEAM, displayName: 'Loanati' },
    );
  });

  it('is refused outside DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(controller().serverJoin(body)).rejects.toThrow(
      ForbiddenException,
    );
    expect(presence.playerJoined).not.toHaveBeenCalled();
  });

  it('refuses a SteamID that belongs to a Raid Ledger account', async () => {
    identitySpy.mockResolvedValue({ userId: 9 });
    await expect(controller().serverJoin(body)).rejects.toThrow(
      BadRequestException,
    );
    expect(presence.playerJoined).not.toHaveBeenCalled();
  });

  it('refuses a game with no live Quick Play (never spawns)', async () => {
    liveSpy.mockResolvedValue(null);
    await expect(controller().serverJoin(body)).rejects.toThrow(
      ConflictException,
    );
    expect(presence.playerJoined).not.toHaveBeenCalled();
  });

  it('rejects a malformed SteamID', async () => {
    await expect(
      controller().serverJoin({ ...body, steamId: '123' }),
    ).rejects.toThrow(BadRequestException);
  });
});
