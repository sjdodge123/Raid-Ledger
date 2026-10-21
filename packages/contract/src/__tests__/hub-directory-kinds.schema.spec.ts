/**
 * ROK-1875 — the /hubs directory lists every hub kind: each entry carries its
 * `kind`, the page lists the kinds live on this instance, and the query can
 * narrow to one kind.
 */
import { describe, expect, it } from 'vitest';
import {
  GameHubsSchema,
  HubDirectoryEntrySchema,
  HubDirectoryPageSchema,
  HubDirectoryQuerySchema,
} from '../community-hubs.schema.js';
import { GUILD_KINDS } from '../guilds.schema.js';

const entry = {
  id: 1,
  gameId: 2,
  gameName: 'Valheim',
  gameIconUrl: null,
  name: 'Valheim — Gamernight',
  blurb: null,
  memberCount: 12,
  leaderName: null,
  viewer: 'member',
  kind: 'game_server',
};

describe('HubDirectoryEntrySchema.kind', () => {
  it.each(GUILD_KINDS)('accepts kind %s', (kind) => {
    expect(HubDirectoryEntrySchema.safeParse({ ...entry, kind }).success).toBe(true);
  });

  it('requires kind', () => {
    const { kind: _kind, ...withoutKind } = entry;
    expect(HubDirectoryEntrySchema.safeParse(withoutKind).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(HubDirectoryEntrySchema.safeParse({ ...entry, kind: 'bogus' }).success).toBe(false);
  });
});

describe('HubDirectoryPageSchema.kinds', () => {
  it('parses a page that lists its live kinds', () => {
    const page = { items: [entry], nextCursor: null, total: 1, kinds: ['game_server', 'game_community'] };
    expect(HubDirectoryPageSchema.safeParse(page).success).toBe(true);
  });

  it('requires kinds', () => {
    expect(HubDirectoryPageSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success).toBe(false);
  });
});

describe('HubDirectoryQuerySchema.kind', () => {
  it('is optional and narrows to one kind', () => {
    expect(HubDirectoryQuerySchema.parse({}).kind).toBeUndefined();
    expect(HubDirectoryQuerySchema.parse({ kind: 'wow_guild' }).kind).toBe('wow_guild');
  });

  it('rejects an unknown kind', () => {
    expect(HubDirectoryQuerySchema.safeParse({ kind: 'bogus' }).success).toBe(false);
  });
});

describe('GameHubsSchema', () => {
  it('parses game-page hubs that carry their kind', () => {
    const hubs = { hubs: [{ ...entry, kind: 'game_community' }], myProposals: [], canPropose: true, proposeBlockedReason: null };
    expect(GameHubsSchema.safeParse(hubs).success).toBe(true);
  });
});
