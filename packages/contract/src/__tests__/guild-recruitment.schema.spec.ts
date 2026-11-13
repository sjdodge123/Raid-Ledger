/**
 * ROK-1789 Part A — guild recruitment contract: the stored object with its
 * explicit `recruiting` switch (Q-A5 ruled A), per-row states (ruling A2),
 * the derived headline (A-D3) and the GET/PUT view.
 */
import { describe, expect, it } from 'vitest';
import {
  GUILD_RECRUIT_NOTE_MAX,
  GUILD_RECRUIT_WANTED_MAX,
  GuildRecruitmentSchema,
  GuildRecruitmentStateSchema,
  GuildRecruitmentViewSchema,
  GuildRecruitWantedSchema,
  PutGuildRecruitmentSchema,
  WOW_CLASSIC_RECRUIT_CLASSES,
  WOW_RECRUIT_CLASSES,
  recruitmentHeadline,
  type GuildRecruitWanted,
} from '../index.js';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  className: 'Priest',
  role: 'healer',
  state: 'open',
  ...over,
});

const recruitment = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  recruiting: true,
  wanted: [row({ note: 'Holy' }), row({ className: 'Druid', role: 'tank', state: 'limited' })],
  applyUrl: 'https://example.com/apply',
  ...over,
});

/** The issue messages/codes a failed parse reports, for precise assertions. */
function issuesOf(input: unknown): { codes: string[]; messages: string[]; paths: string[] } {
  const result = GuildRecruitmentSchema.safeParse(input);
  if (result.success) return { codes: [], messages: [], paths: [] };
  return {
    codes: result.error.issues.map((i) => i.code),
    messages: result.error.issues.map((i) => i.message),
    paths: result.error.issues.map((i) => i.path.join('.')),
  };
}

const w = (state: GuildRecruitWanted['state']): GuildRecruitWanted => ({
  className: 'Mage',
  role: 'dps',
  state,
});

describe('GuildRecruitmentSchema — accepts', () => {
  it.each(['open', 'limited', 'closed'])('a row with state %s', (state) => {
    expect(GuildRecruitmentSchema.safeParse(recruitment({ wanted: [row({ state })] })).success).toBe(true);
  });

  it('an empty wanted list', () => {
    expect(GuildRecruitmentSchema.safeParse(recruitment({ wanted: [] })).success).toBe(true);
  });

  it('a null apply URL', () => {
    expect(GuildRecruitmentSchema.safeParse(recruitment({ applyUrl: null })).success).toBe(true);
  });

  it('recruiting: false with rows, keeping each row and its state (ruling A4)', () => {
    const parsed = GuildRecruitmentSchema.parse(recruitment({ recruiting: false }));
    expect(parsed.recruiting).toBe(false);
    expect(parsed.wanted.map((r) => r.state)).toEqual(['open', 'limited']);
  });

  it('the same class under two different roles', () => {
    const wanted = [row({ role: 'healer' }), row({ role: 'dps' })];
    expect(GuildRecruitmentSchema.safeParse(recruitment({ wanted })).success).toBe(true);
  });

  it('exactly the max number of entries', () => {
    const wanted = WOW_RECRUIT_CLASSES.slice(0, GUILD_RECRUIT_WANTED_MAX).map((c) => row({ className: c, role: 'dps' }));
    expect(wanted).toHaveLength(12);
    expect(GuildRecruitmentSchema.safeParse(recruitment({ wanted })).success).toBe(true);
  });

  it('trims a row note', () => {
    expect(GuildRecruitWantedSchema.parse(row({ note: '  Holy  ' })).note).toBe('Holy');
  });

  it('PutGuildRecruitmentSchema is the same whole-object shape', () => {
    expect(PutGuildRecruitmentSchema.parse(recruitment())).toEqual(GuildRecruitmentSchema.parse(recruitment()));
  });
});

describe('GuildRecruitmentSchema — rejects (AC6)', () => {
  it('an unknown top-level key, e.g. the old guild-level state', () => {
    expect(issuesOf(recruitment({ state: 'open' })).codes).toContain('unrecognized_keys');
  });

  it('an unknown key on a row', () => {
    expect(issuesOf(recruitment({ wanted: [row({ spec: 'Holy' })] })).codes).toContain('unrecognized_keys');
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/apply', '/apply'])('the apply URL %s', (applyUrl) => {
    expect(issuesOf(recruitment({ applyUrl })).paths).toContain('applyUrl');
  });

  it('a duplicate class + role pair', () => {
    const { messages, paths } = issuesOf(recruitment({ wanted: [row(), row({ state: 'closed' })] }));
    expect(messages).toContain('Each class + role can be listed once');
    expect(paths).toContain('wanted');
  });

  it('13 entries', () => {
    const wanted = WOW_RECRUIT_CLASSES.map((c) => row({ className: c, role: 'dps' }));
    expect(wanted).toHaveLength(13);
    const { codes, paths } = issuesOf(recruitment({ wanted }));
    expect(codes).toContain('too_big');
    expect(paths).toContain('wanted');
  });

  it('a note over the max', () => {
    const note = 'x'.repeat(GUILD_RECRUIT_NOTE_MAX + 1);
    expect(note).toHaveLength(61);
    expect(issuesOf(recruitment({ wanted: [row({ note })] })).paths).toContain('wanted.0.note');
  });

  it('an unknown class', () => {
    expect(issuesOf(recruitment({ wanted: [row({ className: 'Bard' })] })).paths).toContain('wanted.0.className');
  });

  it('a row without state', () => {
    const { state: _omit, ...noState } = row();
    expect(issuesOf(recruitment({ wanted: [noState] })).paths).toContain('wanted.0.state');
  });

  it('a row with an unknown state', () => {
    expect(issuesOf(recruitment({ wanted: [row({ state: 'maybe' })] })).paths).toContain('wanted.0.state');
  });

  it('an object without recruiting', () => {
    const { recruiting: _omit, ...noSwitch } = recruitment();
    expect(issuesOf(noSwitch).paths).toContain('recruiting');
  });

  it('a non-boolean recruiting', () => {
    expect(issuesOf(recruitment({ recruiting: 'yes' })).paths).toContain('recruiting');
  });
});

describe('recruitmentHeadline (AC2, A-D3)', () => {
  it('switch off → closed, whatever the rows say', () => {
    expect(recruitmentHeadline({ recruiting: false, wanted: [w('open')] })).toBe('closed');
  });

  it('switch on + empty list → open ("Any class or role")', () => {
    expect(recruitmentHeadline({ recruiting: true, wanted: [] })).toBe('open');
  });

  it('switch on + at least one open row → open', () => {
    expect(recruitmentHeadline({ recruiting: true, wanted: [w('closed'), w('limited'), w('open')] })).toBe('open');
  });

  it('switch on + no open row but a limited one → limited', () => {
    expect(recruitmentHeadline({ recruiting: true, wanted: [w('closed'), w('limited')] })).toBe('limited');
  });

  it('switch on + every row closed → closed', () => {
    expect(recruitmentHeadline({ recruiting: true, wanted: [w('closed'), w('closed')] })).toBe('closed');
  });
});

describe('class lists and the state enum', () => {
  it('offers 13 classes, and the 9 Classic classes as a subset', () => {
    expect(WOW_RECRUIT_CLASSES).toHaveLength(13);
    expect(WOW_CLASSIC_RECRUIT_CLASSES).toHaveLength(9);
    expect(WOW_CLASSIC_RECRUIT_CLASSES.every((c) => (WOW_RECRUIT_CLASSES as readonly string[]).includes(c))).toBe(true);
  });

  it('has exactly the three states', () => {
    expect(GuildRecruitmentStateSchema.options).toEqual(['open', 'limited', 'closed']);
  });
});

describe('GuildRecruitmentViewSchema', () => {
  const view = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    recruitment: recruitment(),
    state: 'open',
    updatedAt: '2026-11-12T20:00:00.000Z',
    updatedBy: 'Thrall',
    viewer: { canEdit: true },
    ...over,
  });

  it('accepts a set view and an unset (all-null) view', () => {
    expect(GuildRecruitmentViewSchema.safeParse(view()).success).toBe(true);
    const unset = view({ recruitment: null, state: null, updatedAt: null, updatedBy: null });
    expect(GuildRecruitmentViewSchema.safeParse(unset).success).toBe(true);
  });

  it('rejects a missing derived state, an unknown key and a non-ISO updatedAt', () => {
    const { state: _omit, ...noState } = view();
    expect(GuildRecruitmentViewSchema.safeParse(noState).success).toBe(false);
    expect(GuildRecruitmentViewSchema.safeParse(view({ extra: 1 })).success).toBe(false);
    expect(GuildRecruitmentViewSchema.safeParse(view({ updatedAt: 'yesterday' })).success).toBe(false);
  });

  it('rejects an unknown viewer key', () => {
    expect(GuildRecruitmentViewSchema.safeParse(view({ viewer: { canEdit: true, isGm: true } })).success).toBe(false);
  });
});
