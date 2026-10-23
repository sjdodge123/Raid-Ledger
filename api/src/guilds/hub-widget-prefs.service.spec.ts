/**
 * ROK-1918 — `HubWidgetPrefsService`: parse the PATCH body, store the layout
 * whole (or `null` on Reset) through the profile upsert, write one audit row.
 * Access is the route guard's job (integration-tested in L3), not this one's.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type * as schema from '../drizzle/schema';
import type { GuildProfileSelect } from '../drizzle/schema/guild-profiles';
import { findProfileRow, upsertProfile } from './guild-profile.queries';
import {
  HubWidgetPrefsService,
  auditMetadata,
  readWidgetPrefs,
} from './hub-widget-prefs.service';

jest.mock('./guild-profile.queries', () => ({
  findProfileRow: jest.fn(),
  upsertProfile: jest.fn(),
}));

const findRow = jest.mocked(findProfileRow);
const upsert = jest.mocked(upsertProfile);
const actor = { id: 42, role: 'member' as const };
const LAYOUT = {
  order: ['raids', 'roster'],
  hidden: ['discord'],
  added: ['generic:text'],
  config: { 'generic:text': { title: 'Hello', body: 'Welcome' } },
};

const db: unknown = {};
const log = jest.fn().mockResolvedValue(undefined);

function service(): HubWidgetPrefsService {
  const activity: unknown = { log };
  return new HubWidgetPrefsService(
    db as PostgresJsDatabase<typeof schema>,
    activity as ActivityLogService,
  );
}

function stored(widgetPrefs: unknown): GuildProfileSelect {
  const row: unknown = { guildId: 7, widgetPrefs };
  return row as GuildProfileSelect;
}

beforeEach(() => {
  jest.clearAllMocks();
  upsert.mockResolvedValue(undefined);
});

describe('HubWidgetPrefsService.update', () => {
  it('stores a full layout and returns it', async () => {
    const res = await service().update(actor, 7, LAYOUT);
    expect(res).toEqual({ widgetPrefs: LAYOUT });
    expect(upsert).toHaveBeenCalledWith(db, 7, {
      widgetPrefs: LAYOUT,
      updatedAt: expect.any(Date),
    });
  });

  it('defaults an omitted config to {}', async () => {
    const res = await service().update(actor, 7, {
      order: ['raids'],
      hidden: [],
      added: [],
    });
    expect(res.widgetPrefs).toEqual({
      order: ['raids'],
      hidden: [],
      added: [],
      config: {},
    });
  });

  it('Reset stores null (registry default)', async () => {
    const res = await service().update(actor, 7, { reset: true });
    expect(res).toEqual({ widgetPrefs: null });
    expect(upsert).toHaveBeenCalledWith(db, 7, {
      widgetPrefs: null,
      updatedAt: expect.any(Date),
    });
  });
});

describe('HubWidgetPrefsService.update audit row', () => {
  it('writes one hub audit row with counts on save', async () => {
    await service().update(actor, 7, LAYOUT);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'hub',
      7,
      'hub_widget_layout_updated',
      42,
      {
        reset: false,
        order: 2,
        hidden: 1,
        added: 1,
        configured: 1,
      },
    );
  });

  it('writes a reset audit row on Reset', async () => {
    await service().update(actor, 7, { reset: true });
    expect(log).toHaveBeenCalledWith(
      'hub',
      7,
      'hub_widget_layout_updated',
      42,
      {
        reset: true,
      },
    );
  });
});

describe('HubWidgetPrefsService.update validation', () => {
  it.each([
    ['an unknown key', { ...LAYOUT, extra: 1 }],
    ['a duplicate id', { ...LAYOUT, order: ['raids', 'raids'] }],
    ['a bad id', { ...LAYOUT, hidden: ['Not An Id'] }],
    ['config on a plugin widget', { ...LAYOUT, config: { raids: {} } }],
    ['reset: false', { reset: false }],
    ['a missing body', undefined],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    await expect(service().update(actor, 7, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('readWidgetPrefs', () => {
  const typedDb = db as PostgresJsDatabase<typeof schema>;

  it('returns null when the hub has no profile row', async () => {
    findRow.mockResolvedValue(undefined);
    await expect(readWidgetPrefs(typedDb, 7)).resolves.toBeNull();
  });

  it('returns null when the hub never saved a layout', async () => {
    findRow.mockResolvedValue(stored(null));
    await expect(readWidgetPrefs(typedDb, 7)).resolves.toBeNull();
  });

  it('returns the stored layout', async () => {
    findRow.mockResolvedValue(stored(LAYOUT));
    await expect(readWidgetPrefs(typedDb, 7)).resolves.toEqual(LAYOUT);
  });

  it('reads a blob that no longer parses as null instead of throwing', async () => {
    findRow.mockResolvedValue(stored({ order: 'not-a-list' }));
    await expect(readWidgetPrefs(typedDb, 7)).resolves.toBeNull();
  });
});

describe('auditMetadata', () => {
  it('never carries widget ids or config text', () => {
    const meta = auditMetadata(LAYOUT);
    expect(JSON.stringify(meta)).not.toMatch(/raids|Hello|Welcome/);
  });
});
