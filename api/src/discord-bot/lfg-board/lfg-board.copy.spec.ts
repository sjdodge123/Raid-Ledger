/**
 * ROK-1616 AC5 — the board's own explanation of urgency speaks the three
 * horizons, and nothing anywhere still offers the retired 30/60 minute split.
 *
 * A guard rather than a snapshot: the failure mode this catches is a surface
 * left behind by a rename, which a snapshot would happily re-record.
 */
import {
  LFG_BOARD_INTRO_BODY,
  LFG_BOARD_INTRO_TITLE,
} from './lfg-board.constants';

/** Strip block and line comments — a guard must not trip on its own prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('LFG board intro copy (ROK-1616 AC5)', () => {
  it('names all three horizons, each with how long it lasts', () => {
    expect(LFG_BOARD_INTRO_BODY).toContain(
      '**When**: Right now (drops after 30 min) · Tonight (until 4 AM) · ' +
        'This week (next 14 days).',
    );
  });

  it('explains that Tonight survives a night running past midnight', () => {
    expect(LFG_BOARD_INTRO_BODY).toMatch(/4\s?AM|04:00/);
  });

  it('no longer offers a 30 vs 60 minute choice', () => {
    // ROK-1658: "30 min" now appears exactly once, as Right now's lifetime —
    // never as one side of the retired 30/60 split.
    const body = stripComments(LFG_BOARD_INTRO_BODY);
    expect(body).not.toMatch(/1 hour|60 min|30 or 60|30\/60/);
    expect(body.match(/30 min/g)).toEqual(['30 min']);
    expect(body).toContain('Right now (drops after 30 min)');
  });

  it("still fits inside Discord's 2000-character message cap", () => {
    expect(LFG_BOARD_INTRO_TITLE.length).toBeGreaterThan(0);
    expect(LFG_BOARD_INTRO_BODY.length).toBeLessThan(2000);
  });
});
