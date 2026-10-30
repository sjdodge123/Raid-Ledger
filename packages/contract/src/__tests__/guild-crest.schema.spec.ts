/**
 * ROK-1814 — guild crest contract: preset (emblem + palette ids, fg ≠ bg),
 * the `source` union ROK-1170 extends, the editor writes, and the additive
 * `GuildSummary.crest` field.
 */
import { describe, expect, it } from 'vitest';
import {
  GUILD_CREST_EMBLEM_IDS,
  GUILD_CREST_EMBLEM_CREDITS,
  GUILD_CREST_MAX_EDGE,
  GUILD_CREST_MIN_EDGE,
  GUILD_CREST_PALETTE,
  GUILD_CREST_PALETTE_IDS,
  GUILD_CREST_UPLOAD_MAX_BYTES,
  GuildCrestEditorStateSchema,
  GuildCrestPresetSchema,
  GuildCrestSchema,
  GuildCrestUploadErrorCodeSchema,
  SetGuildCrestFromGallerySchema,
  SetGuildCrestSchema,
} from '../guild-crest.schema.js';
import { GuildSummarySchema } from '../guilds.schema.js';

const preset = { emblemId: 'dragon-head', fg: 'or', bg: 'azure' } as const;
const upload = {
  source: 'upload',
  urlSm: '/uploads/guild-crests/7/abc.sm.webp',
  urlLg: '/uploads/guild-crests/7/abc.lg.webp',
} as const;
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

describe('constants', () => {
  it('ships ~16 unique emblems, each credited', () => {
    expect(GUILD_CREST_EMBLEM_IDS.length).toBe(16);
    expect(new Set(GUILD_CREST_EMBLEM_IDS).size).toBe(16);
    for (const e of GUILD_CREST_EMBLEM_IDS) {
      expect(GUILD_CREST_EMBLEM_CREDITS[e]).toMatch(/\S/);
    }
  });

  it('ships 12 palette colours as #rrggbb, ids matching the record', () => {
    expect(GUILD_CREST_PALETTE_IDS.length).toBe(12);
    expect(Object.keys(GUILD_CREST_PALETTE).sort()).toEqual(
      [...GUILD_CREST_PALETTE_IDS].sort(),
    );
    for (const hex of Object.values(GUILD_CREST_PALETTE)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('pins the upload limits (Q5)', () => {
    expect(GUILD_CREST_UPLOAD_MAX_BYTES).toBe(1_048_576);
    expect(GUILD_CREST_MIN_EDGE).toBe(64);
    expect(GUILD_CREST_MAX_EDGE).toBe(1024);
  });

  it('lists the coded upload errors', () => {
    expect(GuildCrestUploadErrorCodeSchema.options).toEqual([
      'not_image',
      'too_large',
      'too_small',
      'too_big_dimensions',
      'rate_limited',
    ]);
  });
});

describe('GuildCrestPresetSchema', () => {
  it('accepts a valid preset', () => {
    expect(GuildCrestPresetSchema.parse(preset)).toEqual(preset);
  });

  it('rejects fg === bg on the bg path', () => {
    const r = GuildCrestPresetSchema.safeParse({ ...preset, bg: 'or' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['bg']);
  });

  it.each([
    ['emblemId', { ...preset, emblemId: 'rubber-duck' }],
    ['fg', { ...preset, fg: '#ffffff' }],
    ['bg', { ...preset, bg: 'chartreuse' }],
  ])('rejects an unknown %s', (field, value) => {
    const r = GuildCrestPresetSchema.safeParse(value);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([field]);
  });

  it('is strict', () => {
    expect(GuildCrestPresetSchema.safeParse({ ...preset, x: 1 }).success).toBe(
      false,
    );
  });
});

describe('GuildCrestSchema', () => {
  it('accepts an upload and a preset', () => {
    expect(GuildCrestSchema.parse(upload)).toEqual(upload);
    const p = { source: 'preset', ...preset };
    expect(GuildCrestSchema.parse(p)).toEqual(p);
  });

  it('rejects an unknown source (blizzard arrives with ROK-1170)', () => {
    const r = GuildCrestSchema.safeParse({ source: 'blizzard', urlSm: 'x' });
    expect(r.success).toBe(false);
  });

  it('applies fg ≠ bg inside the union too', () => {
    const r = GuildCrestSchema.safeParse({
      source: 'preset',
      ...preset,
      fg: 'azure',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an upload missing a size', () => {
    const { urlLg, ...rest } = upload;
    void urlLg;
    expect(GuildCrestSchema.safeParse(rest).success).toBe(false);
  });
});

describe('GuildSummarySchema.crest (additive)', () => {
  it('still parses an old summary without crest', () => {
    expect(GuildSummarySchema.parse(summary).crest).toBeUndefined();
  });

  it('accepts null and a crest', () => {
    expect(GuildSummarySchema.parse({ ...summary, crest: null }).crest).toBe(
      null,
    );
    expect(GuildSummarySchema.parse({ ...summary, crest: upload }).crest).toEqual(
      upload,
    );
  });

  it('rejects a malformed crest on the crest path', () => {
    const r = GuildSummarySchema.safeParse({
      ...summary,
      crest: { source: 'preset', emblemId: 'nope', fg: 'or', bg: 'azure' },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path[0]).toBe('crest');
  });
});

describe('editor payloads', () => {
  it('parses the editor state', () => {
    const state = {
      active: 'preset',
      upload: { urlSm: upload.urlSm, urlLg: upload.urlLg },
      preset,
      removedByStaffAt: null,
    };
    expect(GuildCrestEditorStateSchema.parse(state)).toEqual(state);
    expect(
      GuildCrestEditorStateSchema.safeParse({ ...state, active: 'blizzard' })
        .success,
    ).toBe(false);
  });

  it.each([
    { active: 'preset', preset },
    { active: 'upload' },
    { active: null },
  ])('SetGuildCrestSchema accepts %o', (body) => {
    expect(SetGuildCrestSchema.parse(body)).toEqual(body);
  });

  it('SetGuildCrestSchema rejects a preset switch without a preset', () => {
    expect(SetGuildCrestSchema.safeParse({ active: 'preset' }).success).toBe(
      false,
    );
    expect(
      SetGuildCrestSchema.safeParse({ active: 'upload', preset }).success,
    ).toBe(false);
  });

  it('SetGuildCrestFromGallerySchema takes a positive integer media id', () => {
    expect(SetGuildCrestFromGallerySchema.parse({ mediaId: 5 })).toEqual({
      mediaId: 5,
    });
    for (const mediaId of [0, -1, 1.5, '5']) {
      expect(SetGuildCrestFromGallerySchema.safeParse({ mediaId }).success).toBe(
        false,
      );
    }
    expect(
      SetGuildCrestFromGallerySchema.safeParse({ mediaId: 5, x: 1 }).success,
    ).toBe(false);
  });
});
