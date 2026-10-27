/**
 * ROK-1950 — renaming a hub: `PATCH /guilds/:id/name` takes a hub name (the
 * create rules) or `null` (server hubs: back to the server name). The summary
 * and the server block gain optional keys, so older payloads still parse.
 */
import { describe, expect, it } from 'vitest';
import { HubRenameSchema } from '../hub-rename.schema.js';
import {
  GuildPageServerSchema,
  GuildSummarySchema,
} from '../guilds.schema.js';
import { ActivityActionSchema } from '../activity-log.schema.js';

const summary = {
  id: 7,
  gameId: 3,
  kind: 'game_server',
  name: 'Vale',
  region: 'server',
  realmSlug: null,
  realmName: null,
  faction: null,
  memberCount: 0,
  lastSnapshotAt: null,
};

const server = {
  pelicanServerId: 4,
  gameSlug: 'valheim',
  gameIconUrl: null,
  state: 'running',
  viewerJoined: false,
};

describe('HubRenameSchema (ROK-1950)', () => {
  it('accepts a valid name and trims it', () => {
    expect(HubRenameSchema.parse({ name: '  Our Viking Home ' })).toEqual({
      name: 'Our Viking Home',
    });
  });

  it('accepts null (reset to the source name)', () => {
    expect(HubRenameSchema.parse({ name: null })).toEqual({ name: null });
  });

  it.each([
    ['too short after trim', '  ab '],
    ['too long', 'x'.repeat(65)],
    ['no letter or digit', '!!!'],
    ['a control character', 'Bad\u0007Name'],
  ])('rejects a name that is %s', (_label, name) => {
    expect(HubRenameSchema.safeParse({ name }).success).toBe(false);
  });

  it('rejects a missing name and extra keys', () => {
    expect(HubRenameSchema.safeParse({}).success).toBe(false);
    expect(
      HubRenameSchema.safeParse({ name: 'Fine Name', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('rename fields on existing shapes (ROK-1950, additive)', () => {
  it('GuildSummarySchema parses with and without nameOverridden', () => {
    expect(GuildSummarySchema.safeParse(summary).success).toBe(true);
    const parsed = GuildSummarySchema.parse({ ...summary, nameOverridden: true });
    expect(parsed.nameOverridden).toBe(true);
  });

  it('GuildPageServerSchema parses with and without serverName (≤64)', () => {
    expect(GuildPageServerSchema.safeParse(server).success).toBe(true);
    const parsed = GuildPageServerSchema.parse({ ...server, serverName: 'Valheim Main' });
    expect(parsed.serverName).toBe('Valheim Main');
    expect(
      GuildPageServerSchema.safeParse({ ...server, serverName: 'x'.repeat(65) }).success,
    ).toBe(false);
  });

  it('hub_renamed is an activity action', () => {
    expect(ActivityActionSchema.safeParse('hub_renamed').success).toBe(true);
  });
});
