/**
 * ROK-1813 — pure public-card helpers: rounding (D6), https-only apply URL
 * (D7), the base62 slug (D1) and stored → public recruitment (note dropped).
 */
import {
  PublicGuildCardSlugSchema,
  PublicGuildRecruitmentSchema,
  type GuildRecruitment,
} from '@raid-ledger/contract';
import {
  generateCardSlug,
  roundMemberCount,
  safeApplyUrl,
  toPublicRecruitment,
} from './guild-public-card.helpers';

const stored = (over: Partial<GuildRecruitment> = {}): GuildRecruitment => ({
  recruiting: true,
  wanted: [
    { className: 'Priest', role: 'healer', state: 'limited', note: 'Ask Bob' },
    { className: 'Druid', role: 'tank', state: 'open' },
  ],
  applyUrl: 'https://example.com/apply',
  ...over,
});

describe('roundMemberCount', () => {
  it.each([
    [0, null],
    [9, null],
    [10, 10],
    [14, 10],
    [15, 20],
    [143, 140],
    [145, 150],
  ])('%i → %p', (n, expected) => {
    expect(roundMemberCount(n)).toBe(expected);
  });

  it('treats a non-finite count as fewer than 10', () => {
    expect(roundMemberCount(Number.NaN)).toBeNull();
  });
});

describe('safeApplyUrl', () => {
  it('keeps an https URL', () => {
    expect(safeApplyUrl('https://example.com/apply')).toBe(
      'https://example.com/apply',
    );
  });

  it.each([
    'http://example.com/apply',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'not a url',
  ])('drops %s', (u) => {
    expect(safeApplyUrl(u)).toBeNull();
  });

  it('passes null through', () => {
    expect(safeApplyUrl(null)).toBeNull();
  });
});

describe('generateCardSlug', () => {
  it('is 16 base62 characters and passes the contract slug schema', () => {
    for (let i = 0; i < 200; i += 1) {
      const slug = generateCardSlug();
      expect(slug).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(PublicGuildCardSlugSchema.safeParse(slug).success).toBe(true);
    }
  });

  it('does not repeat across draws', () => {
    const slugs = new Set(Array.from({ length: 500 }, generateCardSlug));
    expect(slugs.size).toBe(500);
  });
});

describe('toPublicRecruitment', () => {
  it('drops every note and derives the headline state', () => {
    const out = toPublicRecruitment(stored());
    expect(out).toEqual({
      state: 'open',
      wanted: [
        { className: 'Priest', role: 'healer', state: 'limited' },
        { className: 'Druid', role: 'tank', state: 'open' },
      ],
      applyUrl: 'https://example.com/apply',
    });
    expect(JSON.stringify(out)).not.toContain('Ask Bob');
  });

  it('switch off → closed', () => {
    expect(toPublicRecruitment(stored({ recruiting: false }))?.state).toBe(
      'closed',
    );
  });

  it('nulls an http apply URL', () => {
    const out = toPublicRecruitment(
      stored({ applyUrl: 'http://example.com/apply' }),
    );
    expect(out?.applyUrl).toBeNull();
  });

  it('output passes the strict public schema', () => {
    const out = toPublicRecruitment(stored());
    expect(PublicGuildRecruitmentSchema.safeParse(out).success).toBe(true);
  });

  it.each([null, undefined, { state: 'open' }, 'junk'])(
    'unset or malformed %p → null',
    (value) => {
      expect(toPublicRecruitment(value)).toBeNull();
    },
  );
});
