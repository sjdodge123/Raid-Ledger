/** ROK-1832 D6b / OQ-3 — when an update newly tags a group. */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { createMockEvent } from '../common/testing/factories';
import {
  emitNewGroupTag,
  findSeriesTagTargets,
  isNewGroupTag,
} from './event-group-tag.helpers';
import { HUB_NOTIFICATION_EVENTS } from '../notifications/hub-notification.constants';

const GROUP = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('isNewGroupTag', () => {
  it.each([
    [7, null, true],
    [7, 3, true],
    [7, 7, false],
    [null, 7, false],
    [undefined, 7, false],
  ])('next=%s stored=%s → %s', (next, stored, expected) => {
    expect(isNewGroupTag(next, stored)).toBe(expected);
  });
});

describe('findSeriesTagTargets', () => {
  let db: MockDb;
  beforeEach(() => {
    db = createDrizzleMock();
  });

  function series(guildIds: Array<number | null>): void {
    const rows = guildIds.map((guildId, i) =>
      createMockEvent({ id: i + 1, recurrenceGroupId: GROUP, guildId }),
    );
    db.limit.mockResolvedValueOnce(rows.slice(0, 1));
    db.orderBy.mockResolvedValueOnce(rows);
  }

  it('returns only occurrences whose stored group differs', async () => {
    series([null, 7, 3]);
    const ids = await findSeriesTagTargets(db as never, 1, 'all', {
      guildId: 7,
    });
    expect(ids).toEqual([1, 3]);
  });

  it('a series re-save with the same group returns nothing', async () => {
    series([7, 7]);
    const ids = await findSeriesTagTargets(db as never, 1, 'all', {
      guildId: 7,
    });
    expect(ids).toEqual([]);
  });

  it('untagging or not touching the group reads nothing', async () => {
    expect(await findSeriesTagTargets(db as never, 1, 'all', {})).toEqual([]);
    expect(
      await findSeriesTagTargets(db as never, 1, 'all', { guildId: null }),
    ).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('emitNewGroupTag', () => {
  it('emits EVENT_TAGGED only when the update newly sets a group', () => {
    const emit = jest.fn();
    emitNewGroupTag({ emit }, 7, 3, null);
    expect(emit).toHaveBeenCalledWith(HUB_NOTIFICATION_EVENTS.EVENT_TAGGED, {
      eventId: 7,
    });
    emit.mockClear();
    emitNewGroupTag({ emit }, 7, 3, 3);
    emitNewGroupTag({ emit }, 7, undefined, null);
    emitNewGroupTag({ emit }, 7, null, 3);
    expect(emit).not.toHaveBeenCalled();
  });
});
