/**
 * ROK-1831: the additive game-server community hub shapes — the admin
 * `communityHub` toggle, the server member columns, the page `server` block
 * and the join / quick-play / hide payloads.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  GuildMemberRowSchema,
  GuildPageSchema,
  GuildSummarySchema,
  MyGuildSchema,
} from '../guilds.schema.js';
import {
  PelicanServerRowSchema,
  PelicanServerUpdateSchema,
} from '../pelican-servers.schema.js';
import {
  HubHideSchema,
  HubJoinResponseSchema,
  HubQuickPlayListSchema,
} from '../hub-server.schema.js';

const NOW = '2026-10-18T12:00:00.000Z';

const summary = {
  id: 7,
  gameId: 1,
  kind: 'wow_guild',
  name: 'Iron Vanguard',
  region: 'us',
  realmSlug: null,
  realmName: null,
  faction: null,
  memberCount: 3,
  lastSnapshotAt: null,
};

const wowMember = {
  memberId: 1,
  name: 'Thrall',
  class: 'Shaman',
  level: 60,
  rankIndex: 0,
  rankName: 'GM',
  effectiveRole: 'healer',
  characterId: null,
  isMain: true,
};

const wowPage = {
  guild: summary,
  importedBy: null,
  viewer: { role: 'member', canEdit: false, canManageEditors: false },
  ranks: [{ rankIndex: 0, rankName: 'GM', members: [wowMember] }],
  roleCounts: { tank: 0, healer: 1, dps: 0, unknown: 0 },
};

const serverBlock = {
  pelicanServerId: 4,
  gameSlug: 'valheim',
  gameIconUrl: null,
  state: 'running',
  viewerJoined: false,
};

const pelicanRow = {
  id: 4,
  name: 'Valheim — Main',
  state: 'running',
  isSuspended: false,
  gameId: 2,
  gameName: 'Valheim',
  showOnCalendar: true,
  presenceTracking: true,
  presenceSupported: true,
  lastSyncedAt: null,
  statusCheckedAt: null,
  missing: false,
};

describe('PelicanServerRowSchema.communityHub (ROK-1831)', () => {
  it('still parses a row without communityHub (additive)', () => {
    expect(
      PelicanServerRowSchema.parse(pelicanRow).communityHub,
    ).toBeUndefined();
  });

  it('accepts null (never enabled) and a { guildId, hidden } object', () => {
    expect(
      PelicanServerRowSchema.parse({ ...pelicanRow, communityHub: null })
        .communityHub,
    ).toBeNull();
    const hub = { guildId: 9, hidden: true };
    expect(
      PelicanServerRowSchema.parse({ ...pelicanRow, communityHub: hub })
        .communityHub,
    ).toEqual(hub);
  });

  it('rejects a hub without guildId and an extra key', () => {
    const noId = { ...pelicanRow, communityHub: { hidden: false } };
    expect(PelicanServerRowSchema.safeParse(noId).success).toBe(false);
    const extra = {
      ...pelicanRow,
      communityHub: { guildId: 9, hidden: false, name: 'x' },
    };
    expect(PelicanServerRowSchema.safeParse(extra).success).toBe(false);
  });
});

describe('PelicanServerUpdateSchema.communityHub (ROK-1831)', () => {
  it('accepts communityHub alone as a boolean', () => {
    expect(PelicanServerUpdateSchema.parse({ communityHub: true })).toEqual({
      communityHub: true,
    });
  });

  it('rejects a non-boolean communityHub', () => {
    const r = PelicanServerUpdateSchema.safeParse({ communityHub: 'yes' });
    expect(r.success).toBe(false);
  });
});

describe('GuildMemberRowSchema.server (ROK-1831)', () => {
  it('parses a WoW row with no server block unchanged', () => {
    expect(GuildMemberRowSchema.parse(wowMember)).toEqual(wowMember);
  });

  it('accepts a server block', () => {
    const server = {
      lastSeenAt: NOW,
      onlineNow: true,
      characterName: null,
      source: 'presence',
    };
    const row = GuildMemberRowSchema.parse({ ...wowMember, server });
    expect(row.server).toEqual(server);
  });

  it('rejects an unknown source and an extra server key', () => {
    const base = { lastSeenAt: null, onlineNow: false, characterName: null };
    const badSource = { ...wowMember, server: { ...base, source: 'steam' } };
    expect(GuildMemberRowSchema.safeParse(badSource).success).toBe(false);
    const extra = {
      ...wowMember,
      server: { ...base, source: 'manual', steamId: '7656' },
    };
    expect(GuildMemberRowSchema.safeParse(extra).success).toBe(false);
  });
});

describe('GuildSummarySchema.hidden (ROK-1831)', () => {
  it('is optional and boolean', () => {
    expect(GuildSummarySchema.parse(summary).hidden).toBeUndefined();
    expect(GuildSummarySchema.parse({ ...summary, hidden: true }).hidden).toBe(
      true,
    );
    const bad = GuildSummarySchema.safeParse({ ...summary, hidden: 'no' });
    expect(bad.success).toBe(false);
  });
});

describe('GuildPageSchema.server (ROK-1831)', () => {
  it('parses a current WoW guild page with no server block', () => {
    expect(GuildPageSchema.parse(wowPage).server).toBeUndefined();
  });

  it('accepts a server block on a game_server page', () => {
    const page = {
      ...wowPage,
      guild: { ...summary, kind: 'game_server' },
      server: serverBlock,
    };
    expect(GuildPageSchema.parse(page).server).toEqual(serverBlock);
  });

  it('rejects an unknown server state', () => {
    const page = { ...wowPage, server: { ...serverBlock, state: 'melting' } };
    const r = GuildPageSchema.safeParse(page);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['server', 'state']);
  });
});

describe('hub-server payloads (ROK-1831)', () => {
  it('HubJoinResponseSchema takes { joined } only', () => {
    expect(HubJoinResponseSchema.parse({ joined: true })).toEqual({
      joined: true,
    });
    expect(HubJoinResponseSchema.safeParse({}).success).toBe(false);
  });

  it('HubHideSchema takes { hidden } only', () => {
    expect(HubHideSchema.parse({ hidden: false })).toEqual({ hidden: false });
    const extra = HubHideSchema.safeParse({ hidden: true, reason: 'x' });
    expect(extra.success).toBe(false);
  });

  it('HubQuickPlayListSchema accepts an ongoing and an ended session', () => {
    const data = [
      {
        eventId: 11,
        startedAt: NOW,
        endedAt: null,
        status: 'live',
        participantCount: 3,
      },
      {
        eventId: 10,
        startedAt: NOW,
        endedAt: NOW,
        status: 'ended',
        participantCount: 0,
      },
    ];
    expect(HubQuickPlayListSchema.parse({ data }).data).toHaveLength(2);
  });

  it('HubQuickPlayListSchema rejects a negative count and a bad status', () => {
    const item = {
      eventId: 11,
      startedAt: NOW,
      endedAt: null,
      status: 'live',
      participantCount: -1,
    };
    const neg = HubQuickPlayListSchema.safeParse({ data: [item] });
    expect(neg.success).toBe(false);
    const bad = { ...item, participantCount: 1, status: 'paused' };
    expect(HubQuickPlayListSchema.safeParse({ data: [bad] }).success).toBe(
      false,
    );
  });
});

describe('L3-ii additive fields (ROK-1831)', () => {
  const server = {
    lastSeenAt: NOW,
    onlineNow: false,
    characterName: null,
    source: 'presence',
  };
  const arrival = {
    memberId: 3,
    name: 'Ada',
    characterName: 'Viking',
    firstSeenAt: NOW,
  };

  it('accepts firstSeenAt (iso or null) on a server member block', () => {
    for (const firstSeenAt of [NOW, null]) {
      const row = GuildMemberRowSchema.parse({
        ...wowMember,
        server: { ...server, firstSeenAt },
      });
      expect(row.server?.firstSeenAt).toBe(firstSeenAt);
    }
  });

  it('accepts recentArrivals (max 5) and rejects 6 or an extra key', () => {
    const page = (recentArrivals: unknown[]) => ({
      ...wowPage,
      server: { ...serverBlock, recentArrivals },
    });
    expect(
      GuildPageSchema.parse(page([arrival])).server?.recentArrivals,
    ).toEqual([arrival]);
    const six = Array.from({ length: 6 }, () => arrival);
    expect(GuildPageSchema.safeParse(page(six)).success).toBe(false);
    const extra = page([{ ...arrival, steamId: '7656' }]);
    expect(GuildPageSchema.safeParse(extra).success).toBe(false);
  });

  it('accepts MyGuild.gameIconUrl as a string, null or absent', () => {
    const mine = {
      ...summary,
      rankIndex: null,
      rankName: null,
      canEdit: false,
      gmPostHeadline: null,
    };
    expect(MyGuildSchema.parse(mine).gameIconUrl).toBeUndefined();
    expect(
      MyGuildSchema.parse({ ...mine, gameIconUrl: 'https://x/y.png' })
        .gameIconUrl,
    ).toBe('https://x/y.png');
    expect(MyGuildSchema.parse({ ...mine, gameIconUrl: null }).gameIconUrl).toBeNull();
  });
});
