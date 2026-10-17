/**
 * ROK-1460 (slice B) — TDD pins for the `RosterEntry` overload of `formatRoster`.
 *
 * Spec `planning-artifacts/specs/ROK-1460.md` §Roster (operator decision D8):
 * decorations (⏳ ⏰, class/role emoji, ~~left~~) must survive sanitisation, so
 * the formatter takes structured entries instead of pre-decorated strings.
 *
 *   RosterEntry = { name: string; prefix?: string; suffix?: string; struck?: boolean }
 *   render      = `${prefix ?? ''}**${escape(name)}**${suffix ?? ''}`
 *                 with the bold name wrapped in `~~` when `struck`.
 *
 * `name` is sanitised/escaped; `prefix`/`suffix` are trusted emoji strings and
 * are emitted verbatim.
 */
import {
  formatRoster,
  ROSTER_NAME_CAP,
  type RosterEntry,
} from './embed-roster.helpers';

const HOURGLASS = '⏳';
const ALARM = '⏰';
const HEART = '💚';
const SWORD = '⚔️';

function entry(name: string, rest: Partial<RosterEntry> = {}): RosterEntry {
  return { name, ...rest };
}

describe('formatRoster(RosterEntry[]) — decorations survive sanitisation', () => {
  it('renders a bare entry as a bold name', () => {
    expect(formatRoster([entry('Ana')])).toBe('**Ana**');
  });

  it('keeps a prefix and a suffix around the bold name', () => {
    expect(
      formatRoster([
        entry('Bo', { prefix: `${HOURGLASS} `, suffix: ` ${HEART}` }),
      ]),
    ).toBe(`${HOURGLASS} **Bo** ${HEART}`);
  });

  it('strikes through the bold name when the signup left', () => {
    expect(formatRoster([entry('Cy', { struck: true })])).toBe('~~**Cy**~~');
  });

  it('does not escape the strike markers it emits itself', () => {
    const rendered = formatRoster([entry('Cy', { struck: true })]);
    expect(rendered).not.toContain('\\~');
  });

  it('composes running-late with tentative and a role suffix', () => {
    expect(
      formatRoster([
        entry('Dee', {
          prefix: `${HOURGLASS} ${ALARM} `,
          suffix: ` ${SWORD}`,
        }),
      ]),
    ).toBe(`${HOURGLASS} ${ALARM} **Dee** ${SWORD}`);
  });

  it('joins entries with a middle dot', () => {
    expect(formatRoster([entry('Ana'), entry('Bo')])).toBe('**Ana** · **Bo**');
  });

  it('returns an empty string for an empty roster', () => {
    expect(formatRoster([] as RosterEntry[])).toBe('');
  });
});

describe('formatRoster(RosterEntry[]) — section cap', () => {
  const seven = ['Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'].map((n) =>
    entry(n),
  );

  it('caps a section at six names and reports the overflow', () => {
    expect(ROSTER_NAME_CAP).toBe(6);
    expect(formatRoster(seven)).toBe(
      '**Ana** · **Bo** · **Cy** · **Dee** · **Eli** · **Fay** +1 more',
    );
  });

  it('renders no overflow marker at exactly the cap', () => {
    expect(formatRoster(seven.slice(0, 6))).not.toContain('more');
  });

  it('honours an explicit cap override', () => {
    expect(formatRoster(seven, 2)).toBe('**Ana** · **Bo** +5 more');
  });
});

describe('formatRoster(RosterEntry[]) — names stay sanitised', () => {
  it('escapes markdown markers inside a name', () => {
    expect(formatRoster([entry('snake_case')])).toBe('**snake\\_case**');
  });

  it('defangs a mention-shaped name and never emits a ping', () => {
    const rendered = formatRoster([entry('<@123456789>')]);
    expect(rendered).not.toContain('<@');
    expect(rendered).not.toContain('>');
  });

  it('never emits `<@` for any entry, decorated or struck', () => {
    const rendered = formatRoster([
      entry('<@!111>', { prefix: `${HOURGLASS} `, struck: true }),
      entry('<@&222>', { suffix: ` ${SWORD}` }),
    ]);
    expect(rendered).not.toContain('<@');
  });
});

describe('formatRoster — the string[] form still works (slice A callers)', () => {
  it('renders plain names as bold names', () => {
    expect(formatRoster(['Ana', 'Bo'])).toBe('**Ana** · **Bo**');
  });

  it('still caps and reports overflow', () => {
    expect(
      formatRoster(['Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus']),
    ).toContain('+1 more');
  });
});
