/**
 * ROK-1454 D9 — the restart reconcile on CONNECTED.
 *
 * Moved out of `lfm-embed.service.spec.ts` (ROK-1505: that file was at 736 of
 * its 750 counted lines). Same fixtures, same fake table — see
 * `lfm-embed.service.spec-helpers.ts`. The high-risk claim pinned here is the
 * AC9 wedge: `insertLfmMessage` in the fixture MODELS the partial unique index
 * by throwing on a second `open` row, so a missed reconcile fails the way
 * production would — the game can never post again.
 */
import * as store from './lfm-embed.db-helpers';
import type { LfmEmbedService } from './lfm-embed.service';
import {
  client,
  createService,
  edited,
  EVENT_ID,
  GAME_ID,
  live,
  member,
  openRow,
  rowById,
  seedOpenRow,
} from './lfm-embed.service.spec-helpers';

jest.mock('./lfm-embed.db-helpers');

let service: LfmEmbedService;

beforeEach(async () => {
  service = await createService();
});

describe('restart reconcile on CONNECTED (D9)', () => {
  it('heals an edit missed while the bot was down', async () => {
    seedOpenRow();
    jest
      .mocked(store)
      .readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl', 'Doretta']));

    await service.onConnected();

    expect(client.editEmbed.mock.calls[0][1]).toBe('msg-1');
    expect(openRow()).toMatchObject({ state: 'open', lastMemberCount: 3 });
  });

  it('closes a group that converted while the bot was down', async () => {
    seedOpenRow();
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live(['Bosco']));
    s.latestConversionTarget.mockResolvedValue({ eventId: EVENT_ID });
    s.readConvertedGroup.mockResolvedValue(
      ['Bosco', 'Karl', 'Doretta'].map(member),
    );

    await service.onConnected();

    expect(edited().author?.name).toBe('■ SCHEDULED · 3 players');
    expect(rowById('row-1')).toMatchObject({ state: 'converted' });
  });

  it('closes a group that simply died while the bot was down', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    jest.mocked(store).readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();

    expect(edited().author?.name).toBe('■ EXPIRED · 2 were looking');
    expect(rowById('row-1')).toMatchObject({ state: 'expired' });
  });

  it('AC9 wedge — after reconcile the game can post a NEW message again', async () => {
    seedOpenRow({ lastMemberCount: 2 });
    const s = jest.mocked(store);
    s.readLiveGroup.mockResolvedValue(live([]));

    await service.onConnected();
    s.readLiveGroup.mockResolvedValue(live(['Bosco', 'Karl']));
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    // Without the reconcile the stale `open` row survives, `onLfmReached`
    // edits it instead of posting, and the partial unique index means this
    // game can NEVER post an LFM message again.
    expect(openRow()?.messageId).toBe('msg-new');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('one bad row does not abort the rest of the reconcile', async () => {
    seedOpenRow();
    seedOpenRow({ id: 'row-2', gameId: 43, messageId: 'msg-2' });
    client.editEmbed
      .mockRejectedValueOnce(new Error('Missing Access'))
      .mockResolvedValue({ id: 'msg-2' });

    await expect(service.onConnected()).resolves.toBeUndefined();
    expect(client.editEmbed).toHaveBeenCalledTimes(2);
  });

  it('DISCONNECTED drops nothing — the state lives in the table', () => {
    seedOpenRow();

    service.onDisconnected();

    expect(openRow()).toMatchObject({ messageId: 'msg-1' });
    expect(jest.mocked(store).closeLfmMessage).not.toHaveBeenCalled();
    expect(jest.mocked(store).deleteLfmMessage).not.toHaveBeenCalled();
  });
});
