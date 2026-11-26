/**
 * ROK-1573 Lane B — `GET /lfg/:gameId` attaches `convertedEvent`.
 *
 * Wiring only: the read itself is pinned in `lfg-converted-event.helpers.spec`.
 * The helpers are module-mocked so this asserts the service passes the read
 * through verbatim (and does not attach it to the summary DTO).
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { Test } from '@nestjs/testing';
import { LfgService } from './lfg.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as queryHelpers from './lfg-query.helpers';
import * as writeHelpers from './lfg-write.helpers';
import * as convertedHelpers from './lfg-converted-event.helpers';
import * as forumThreadHelpers from './lfg-forum-thread.helpers';
import * as scopeHelpers from './lfg-group-scope.helpers';

import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

jest.mock('./lfg-query.helpers');
jest.mock('./lfg-write.helpers');
jest.mock('./lfg-converted-event.helpers');
// Mock the SOURCE module, never a re-export: an automocked barrel's getter
// re-export would not be the function the detail read actually calls.
jest.mock('./lfg-forum-thread.helpers');
// ROK-2352: the own-hand read moved to the group-scope helpers.
jest.mock('./lfg-group-scope.helpers', () => ({
  ...jest.requireActual<typeof scopeHelpers>('./lfg-group-scope.helpers'),
  findOwnLiveHand: jest.fn(),
  listOwnOtherGroups: jest.fn(),
}));

const GAME = { id: 42, name: 'Valheim' };
const CONVERTED = {
  eventId: 501,
  title: 'Raid night',
  startTime: '2026-09-20T18:00:00.000Z',
  signupCount: 2,
};

/** Build the service with every helper mocked to a neutral read. */
async function buildService(converted: unknown): Promise<LfgService> {
  jest.mocked(queryHelpers.requireGame).mockResolvedValue(GAME as never);
  jest
    .mocked(queryHelpers.getGroupSummary)
    .mockResolvedValue({ gameId: 42, playingNow: null } as never);
  jest.mocked(queryHelpers.listGroupMembers).mockResolvedValue([]);
  jest.mocked(forumThreadHelpers.findOpenForumThreadId).mockResolvedValue(null);
  jest.mocked(writeHelpers.findActiveIntent).mockResolvedValue(null);
  jest.mocked(scopeHelpers.findOwnLiveHand).mockResolvedValue(null);
  jest.mocked(scopeHelpers.listOwnOtherGroups).mockResolvedValue([]);
  jest
    .mocked(convertedHelpers.readConvertedEvent)
    .mockResolvedValue(converted as never);
  const module = await Test.createTestingModule({
    providers: [
      LfgService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: SettingsService, useValue: { get: jest.fn(() => null) } },
      { provide: PluginRegistryService, useValue: { getAdapter: jest.fn() } },
    ],
  }).compile();
  return module.get(LfgService);
}

describe('LfgService.getGroupDetail — convertedEvent (ROK-1573)', () => {
  afterEach(() => jest.resetAllMocks());

  it('attaches the upcoming converted event for the route game', async () => {
    const service = await buildService(CONVERTED);
    const detail = await service.getGroupDetail(7, 42);
    expect(detail.convertedEvent).toEqual(CONVERTED);
    // ROK-2352: a plain read (no `?group`) is the whole game — scope null.
    expect(convertedHelpers.readConvertedEvent).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.any(Date),
      null,
    );
  });

  it('reports convertedEvent: null when the group has none', async () => {
    const service = await buildService(null);
    const detail = await service.getGroupDetail(7, 42);
    expect(detail.convertedEvent).toBeNull();
  });
});
