/**
 * ROK-2187 — "GG <year>": the frozen snapshot shape, the per-card payload
 * schemas (core + plugin), and the DTO allow-lists (public summary = Q4).
 */
import { describe, expect, it } from 'vitest';
import {
  GG_CORE_CARD_IDS,
  GgCardEnvelopeSchema,
  parseGgCardPayload,
} from '../gg-cards.schema.js';
import {
  GgAdminDryRunDtoSchema,
  GgAdminSettingsDtoSchema,
  GgOwnerSnapshotDtoSchema,
  GgPublicSummaryDtoSchema,
  GgShareToggleDtoSchema,
  GgSnapshotSchema,
  parseGgSnapshot,
} from '../gg.schema.js';

const eventsCard = {
  pluginSlug: 'core',
  cardId: 'events',
  order: 20,
  payload: {
    signedUp: 14,
    attended: 12,
    noShows: 1,
    excused: 1,
    created: 3,
    firstEventAt: '2026-01-09T19:00:00.000Z',
    lastEventAt: '2026-12-01T20:00:00.000Z',
  },
};
const valheimCard = {
  pluginSlug: 'valheim',
  cardId: 'valheim-year',
  order: 110,
  payload: { characters: 1, deaths: 42, skillGains: [{ skill: 'Swords', gained: 31.5 }] },
};
const wowCard = {
  pluginSlug: 'blizzard',
  cardId: 'wow-levels',
  order: 120,
  payload: {
    totalDings: 18,
    characters: [{ name: 'Thrall', className: 'Shaman', fromLevel: 42, maxLevel: 60, dings: 18 }],
  },
};

const snapshotV1 = {
  schemaVersion: 1,
  year: 2026,
  window: { from: '2026-01-01T05:00:00.000Z', to: '2026-12-14T23:00:00.000Z' },
  tier: 'full',
  computedAt: '2026-12-14T23:00:00.000Z',
  cards: [eventsCard, valheimCard, wowCard],
};

const publicSummary = {
  year: 2026,
  displayName: 'Roknua',
  avatarUrl: null,
  eventsAttended: 12,
  hoursPlayedSeconds: 360000,
  topGames: [{ name: 'Valheim', coverUrl: null }],
  playedWithCount: 7,
  superlative: 'night-owl',
};

describe('GgSnapshotSchema', () => {
  it('parses a valid v1 snapshot with core and plugin cards', () => {
    expect(parseGgSnapshot(snapshotV1)).toEqual(snapshotV1);
  });

  it('rejects an unknown schemaVersion', () => {
    const result = GgSnapshotSchema.safeParse({ ...snapshotV1, schemaVersion: 99 });
    expect(result.success).toBe(false);
    expect(() => parseGgSnapshot({ ...snapshotV1, schemaVersion: 2 })).toThrow();
  });

  it('rejects an unknown top-level key (strict)', () => {
    expect(GgSnapshotSchema.safeParse({ ...snapshotV1, extra: 1 }).success).toBe(false);
  });

  it('keeps an envelope readable even when its payload is not (web skips the card)', () => {
    const odd = { ...eventsCard, payload: { signedUp: 'lots' } };
    expect(GgCardEnvelopeSchema.safeParse(odd).success).toBe(true);
    expect(parseGgCardPayload(odd)).toBeNull();
  });
});

describe('parseGgCardPayload — per-plugin payload schemas', () => {
  it('validates a core card against its own schema', () => {
    expect(parseGgCardPayload(eventsCard)).toEqual(eventsCard.payload);
  });

  it('validates the valheim and blizzard (wow-common) cards', () => {
    expect(parseGgCardPayload(valheimCard)).toEqual(valheimCard.payload);
    expect(parseGgCardPayload(wowCard)).toEqual(wowCard.payload);
  });

  it('rejects a payload sent under the wrong plugin', () => {
    expect(parseGgCardPayload({ ...valheimCard, pluginSlug: 'blizzard' })).toBeNull();
    expect(parseGgCardPayload({ ...wowCard, payload: valheimCard.payload })).toBeNull();
  });

  it('returns null for an unknown card id', () => {
    expect(parseGgCardPayload({ ...eventsCard, cardId: 'nope' })).toBeNull();
  });

  it('declares the twelve core cards in story order', () => {
    expect(GG_CORE_CARD_IDS).toEqual([
      'intro', 'events', 'on-time', 'rhythm', 'hours', 'top-games',
      'new-games', 'voice', 'people', 'hubs', 'superlative', 'summary',
    ]);
  });
});

describe('GgPublicSummaryDtoSchema (Q4 allow-list)', () => {
  it('accepts the summary fields only', () => {
    expect(GgPublicSummaryDtoSchema.parse(publicSummary)).toEqual(publicSummary);
  });

  it('rejects other players by name — counts only', () => {
    const leaky = { ...publicSummary, playedWith: [{ displayName: 'Jaina' }] };
    expect(GgPublicSummaryDtoSchema.safeParse(leaky).success).toBe(false);
  });

  it('rejects ids and email on the public DTO', () => {
    for (const extra of [{ userId: 4 }, { discordId: '123' }, { email: 'a@b.c' }]) {
      expect(GgPublicSummaryDtoSchema.safeParse({ ...publicSummary, ...extra }).success).toBe(false);
    }
  });
});

describe('owner, share and admin DTOs', () => {
  it('parses the owner read DTO with share state and archive years', () => {
    const dto = {
      year: 2026,
      tier: 'full',
      computedAt: snapshotV1.computedAt,
      cards: snapshotV1.cards,
      share: { shared: false, slug: null, sharedAt: null },
      archiveYears: [2026, 2025],
    };
    expect(GgOwnerSnapshotDtoSchema.parse(dto)).toEqual(dto);
  });

  it('requires a boolean share toggle body', () => {
    expect(GgShareToggleDtoSchema.parse({ shared: true })).toEqual({ shared: true });
    expect(GgShareToggleDtoSchema.safeParse({ shared: 'yes' }).success).toBe(false);
  });

  it('parses admin settings and refuses a bad delivery date or hour', () => {
    const settings = { enabled: false, deliveryDate: '2026-12-14', deliveryHour: 18, dmOffsetMinutes: 15, channelId: null };
    expect(GgAdminSettingsDtoSchema.parse(settings)).toEqual(settings);
    expect(GgAdminSettingsDtoSchema.safeParse({ ...settings, deliveryDate: '14/12/2026' }).success).toBe(false);
    expect(GgAdminSettingsDtoSchema.safeParse({ ...settings, deliveryHour: 24 }).success).toBe(false);
  });

  it('parses the admin dry-run counts with skip reasons', () => {
    const dry = {
      year: 2026, usersComputed: 40, short: 12, full: 28, wouldDm: 30, announcedAt: null,
      skipped: { deactivated: 2, optedOut: 3, noDiscord: 5, noActivity: 9 },
    };
    expect(GgAdminDryRunDtoSchema.parse(dry)).toEqual(dry);
  });
});
