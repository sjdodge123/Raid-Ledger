/**
 * ROK-1789 (S5 part A) — pure recruitment helpers: note/URL normalising,
 * stored-jsonb parsing (malformed or old shape → null), the column patch and
 * the row → view mapping (headline `state` derived, never stored).
 */
import type { GuildRecruitment } from '@raid-ledger/contract';
import {
  buildRecruitmentPatch,
  normaliseRecruitment,
  parseStoredRecruitment,
  toRecruitmentView,
  type RecruitmentRow,
} from './guild-recruitment.helpers';

const NOW = new Date('2026-11-13T10:00:00.000Z');

const recruitment = (
  over: Partial<GuildRecruitment> = {},
): GuildRecruitment => ({
  recruiting: true,
  wanted: [
    { className: 'Priest', role: 'healer', state: 'open', note: 'Holy' },
    { className: 'Druid', role: 'tank', state: 'limited' },
  ],
  applyUrl: 'https://example.com/apply',
  ...over,
});

const row = (over: Partial<RecruitmentRow> = {}): RecruitmentRow => ({
  recruitment: recruitment(),
  updatedAt: NOW,
  updatedBy: 'Thalia',
  ...over,
});

describe('normaliseRecruitment', () => {
  it('trims notes and drops a note that is blank after trimming', () => {
    const out = normaliseRecruitment(
      recruitment({
        wanted: [
          { className: 'Mage', role: 'dps', state: 'open', note: '  Fire  ' },
          { className: 'Rogue', role: 'dps', state: 'closed', note: '   ' },
        ],
      }),
    );
    expect(out.wanted).toEqual([
      { className: 'Mage', role: 'dps', state: 'open', note: 'Fire' },
      { className: 'Rogue', role: 'dps', state: 'closed' },
    ]);
    expect(out.wanted[1]).not.toHaveProperty('note');
  });

  it('trims the apply URL and keeps the switch, row order and row states', () => {
    const out = normaliseRecruitment(
      recruitment({ recruiting: false, applyUrl: ' https://x.test/a ' }),
    );
    expect(out.applyUrl).toBe('https://x.test/a');
    expect(out.recruiting).toBe(false);
    expect(out.wanted.map((w) => w.state)).toEqual(['open', 'limited']);
  });

  it('keeps a null apply URL null', () => {
    expect(normaliseRecruitment(recruitment({ applyUrl: null })).applyUrl).toBe(
      null,
    );
  });
});

describe('parseStoredRecruitment', () => {
  it('returns a valid stored object as-is', () => {
    expect(parseStoredRecruitment(recruitment())).toEqual(recruitment());
  });

  it('returns null for null / undefined (never set)', () => {
    expect(parseStoredRecruitment(null)).toBeNull();
    expect(parseStoredRecruitment(undefined)).toBeNull();
  });

  it('returns null for an old-shape object with a guild state and no switch', () => {
    const oldShape = {
      state: 'open',
      wanted: [{ className: 'Priest', role: 'healer' }],
      applyUrl: null,
    };
    expect(parseStoredRecruitment(oldShape)).toBeNull();
  });

  it('returns null for malformed jsonb (wrong types, unknown class)', () => {
    expect(parseStoredRecruitment('open')).toBeNull();
    expect(parseStoredRecruitment([])).toBeNull();
    const unknownClass: unknown = {
      ...recruitment(),
      wanted: [{ className: 'Necromancer', role: 'dps', state: 'open' }],
    };
    expect(parseStoredRecruitment(unknownClass)).toBeNull();
  });
});

describe('buildRecruitmentPatch', () => {
  it('sets the value, editor and timestamp (and the row updatedAt)', () => {
    const value = recruitment();
    expect(buildRecruitmentPatch(value, 7, NOW)).toEqual({
      recruitment: value,
      recruitmentUpdatedAt: NOW,
      recruitmentUpdatedBy: 7,
      updatedAt: NOW,
    });
  });

  it('a null value clears all three recruitment columns', () => {
    expect(buildRecruitmentPatch(null, 7, NOW)).toEqual({
      recruitment: null,
      recruitmentUpdatedAt: null,
      recruitmentUpdatedBy: null,
      updatedAt: NOW,
    });
  });
});

describe('toRecruitmentView', () => {
  it('maps a set row with its derived headline, ISO time and editor', () => {
    expect(toRecruitmentView(row(), true)).toEqual({
      recruitment: recruitment(),
      state: 'open',
      updatedAt: '2026-11-13T10:00:00.000Z',
      updatedBy: 'Thalia',
      viewer: { canEdit: true },
    });
  });

  it('derives limited when no row is open', () => {
    const r = recruitment({
      wanted: [{ className: 'Druid', role: 'tank', state: 'limited' }],
    });
    expect(toRecruitmentView(row({ recruitment: r }), false).state).toBe(
      'limited',
    );
  });

  it('derives closed when the switch is off but keeps rows and their states', () => {
    const r = recruitment({ recruiting: false });
    const view = toRecruitmentView(row({ recruitment: r }), false);
    expect(view.state).toBe('closed');
    expect(view.recruitment?.wanted.map((w) => w.state)).toEqual([
      'open',
      'limited',
    ]);
  });

  it('derives open for the switch on with an empty list', () => {
    const r = recruitment({ wanted: [] });
    expect(toRecruitmentView(row({ recruitment: r }), false).state).toBe(
      'open',
    );
  });
});

describe('toRecruitmentView — unset', () => {
  it('reads no profile row as unset', () => {
    expect(toRecruitmentView(null, true)).toEqual({
      recruitment: null,
      state: null,
      updatedAt: null,
      updatedBy: null,
      viewer: { canEdit: true },
    });
  });

  it('reads an old-shape stored object as unset, without crashing', () => {
    const view = toRecruitmentView(
      row({ recruitment: { state: 'open', wanted: [], applyUrl: null } }),
      false,
    );
    expect(view).toEqual({
      recruitment: null,
      state: null,
      updatedAt: null,
      updatedBy: null,
      viewer: { canEdit: false },
    });
  });

  it('keeps a null editor (deleted user) as null', () => {
    expect(toRecruitmentView(row({ updatedBy: null }), false).updatedBy).toBe(
      null,
    );
  });
});
