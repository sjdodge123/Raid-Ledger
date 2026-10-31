import type { GuildCrestPreset } from '@raid-ledger/contract';
import {
  buildGuildCrestEditorState,
  resolveGuildCrest,
  type GuildCrestColumns,
} from './hub-crest.resolve';

const KEY = 'aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb';
const preset: GuildCrestPreset = {
  emblemId: 'wolf-head',
  fg: 'argent',
  bg: 'sable',
};
const upload = {
  urlSm: `/uploads/guild-crests/3/${KEY}.sm.webp`,
  urlLg: `/uploads/guild-crests/3/${KEY}.lg.webp`,
};

const row = (over: Partial<GuildCrestColumns>): GuildCrestColumns => ({
  id: 3,
  crestActive: null,
  crestUploadKey: null,
  crestPreset: null,
  crestRemovedAt: null,
  ...over,
});

describe('resolveGuildCrest', () => {
  it.each([
    ['nothing stored', row({}), null],
    [
      'both stored, none active',
      row({ crestUploadKey: KEY, crestPreset: preset }),
      null,
    ],
    [
      'active upload',
      row({ crestActive: 'upload', crestUploadKey: KEY, crestPreset: preset }),
      { source: 'upload', ...upload },
    ],
    [
      'active preset',
      row({ crestActive: 'preset', crestUploadKey: KEY, crestPreset: preset }),
      { source: 'preset', ...preset },
    ],
    [
      'active preset, none stored',
      row({ crestActive: 'preset', crestUploadKey: KEY }),
      null,
    ],
    [
      'removed upload falls back to the preset',
      row({ crestActive: 'upload', crestPreset: preset }),
      { source: 'preset', ...preset },
    ],
    ['removed upload, no preset', row({ crestActive: 'upload' }), null],
    [
      'malformed key is ignored',
      row({ crestActive: 'upload', crestUploadKey: '../x' }),
      null,
    ],
    [
      'stale preset (unknown emblem) is ignored',
      row({
        crestActive: 'preset',
        crestPreset: {
          ...preset,
          emblemId: 'gone',
        } as unknown as GuildCrestPreset,
      }),
      null,
    ],
    [
      'unknown active value',
      row({
        crestActive: 'blizzard',
        crestUploadKey: KEY,
        crestPreset: preset,
      }),
      null,
    ],
  ])('%s', (_label, input, expected) => {
    expect(resolveGuildCrest(input)).toEqual(expected);
  });
});

describe('buildGuildCrestEditorState', () => {
  it('returns both stored crests, the pointer and the staff removal time', () => {
    const removed = new Date('2026-10-29T12:00:00.000Z');
    expect(
      buildGuildCrestEditorState(
        row({
          crestActive: 'preset',
          crestUploadKey: KEY,
          crestPreset: preset,
          crestRemovedAt: removed,
        }),
      ),
    ).toEqual({
      active: 'preset',
      upload,
      preset,
      removedByStaffAt: '2026-10-29T12:00:00.000Z',
    });
  });

  it('nulls everything for a hub that never set a crest', () => {
    expect(buildGuildCrestEditorState(row({}))).toEqual({
      active: null,
      upload: null,
      preset: null,
      removedByStaffAt: null,
    });
  });

  it('reports the effective pointer after a removal (upload gone → preset)', () => {
    expect(
      buildGuildCrestEditorState(
        row({ crestActive: 'upload', crestPreset: preset }),
      ).active,
    ).toBe('preset');
  });
});
