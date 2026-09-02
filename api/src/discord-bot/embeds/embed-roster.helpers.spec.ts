/**
 * ROK-1459 (slice A) — AC4: shared roster formatter.
 *
 * TDD spec written BEFORE `embed-roster.helpers.ts` exists.
 *
 * Contract (spec §1): bold display names joined with ' · ', capped at
 * ROSTER_NAME_CAP with a trailing ' +N more'. Empty input → ''. The output must
 * NEVER contain '<@' — the formatter takes display names, not mentions, and a
 * mention-looking name is defanged rather than passed through.
 */
import { formatRoster, ROSTER_NAME_CAP } from './embed-roster.helpers';

/** ['P1', 'P2', ... 'Pn'] */
function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

describe('ROSTER_NAME_CAP', () => {
  it('is 6', () => {
    expect(ROSTER_NAME_CAP).toBe(6);
  });
});

describe('formatRoster — basic rendering (AC4)', () => {
  it('returns an empty string for no names', () => {
    expect(formatRoster([])).toBe('');
  });

  it('returns a falsy empty roster so callers can substitute a fallback', () => {
    // Discord rejects '' as a field value — the documented contract is that
    // callers write `formatRoster(names) || 'None yet'` (ROK-1459 review F5).
    expect(formatRoster([]) || 'None yet').toBe('None yet');
  });

  it('bolds a single name', () => {
    expect(formatRoster(['Ana'])).toBe('**Ana**');
  });

  it('joins bold names with " · "', () => {
    expect(formatRoster(['Ana', 'Bo', 'Cy'])).toBe('**Ana** · **Bo** · **Cy**');
  });
});

describe('formatRoster — the +N more cap (AC4)', () => {
  it('renders exactly ROSTER_NAME_CAP names with no suffix', () => {
    const out = formatRoster(names(ROSTER_NAME_CAP));
    expect(out).toBe(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => `**${n}**`).join(' · '),
    );
    expect(out).not.toContain('more');
  });

  it('renders "+1 more" at cap + 1', () => {
    const out = formatRoster(names(ROSTER_NAME_CAP + 1));
    expect(out).toBe(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => `**${n}**`).join(' · ') +
        ' +1 more',
    );
    expect(out).not.toContain('P7');
  });

  it('renders "+7 more" for 13 names', () => {
    const out = formatRoster(names(13));
    expect(out.endsWith(' +7 more')).toBe(true);
    expect(out).toContain('**P6**');
    expect(out).not.toContain('**P7**');
  });

  it('honours an explicit cap override', () => {
    expect(formatRoster(names(5), 2)).toBe('**P1** · **P2** +3 more');
  });
});

describe('formatRoster — never emits a mention (AC4)', () => {
  it('strips the angle brackets from a mention-shaped name', () => {
    const out = formatRoster(['<@123>']);
    expect(out).not.toContain('<@');
    expect(out).not.toContain('>');
    expect(out).toContain('123');
  });

  it('never contains "<@" for a mixed roster', () => {
    const out = formatRoster([
      '<@123>',
      'Ana',
      '<@!456>',
      'Bo',
      '<@789>',
      'Cy',
      'Dee',
    ]);
    expect(out).not.toContain('<@');
    expect(out.endsWith(' +1 more')).toBe(true);
  });
});

describe('formatRoster — markdown escaping (AC4)', () => {
  it('escapes an asterisk so bold does not break', () => {
    expect(formatRoster(['Ann*ie'])).toBe('**Ann\\*ie**');
  });

  it('escapes an underscore so italics do not break', () => {
    expect(formatRoster(['snake_case'])).toBe('**snake\\_case**');
  });

  it('escapes both markers inside a multi-name roster', () => {
    const out = formatRoster(['a*b', 'c_d']);
    expect(out).toBe('**a\\*b** · **c\\_d**');
  });

  // ROK-1460 — a display name is user-controlled. Discord renders
  // `[label](url)` as a masked link, so a name shaped like one would turn every
  // re-synced roster into a clickable link the operator never wrote.
  it('defangs a masked link hidden in a display name', () => {
    const out = formatRoster(['[click me](https://evil.example.com)']);
    expect(out).toBe(
      '**\\[click me\\]\\(https://evil.example.com\\)**',
    );
    expect(out).not.toContain('](');
  });

  it('escapes brackets and parentheses on their own', () => {
    expect(formatRoster(['Ana (main)'])).toBe('**Ana \\(main\\)**');
    expect(formatRoster(['[AFK] Bo'])).toBe('**\\[AFK\\] Bo**');
  });
});
