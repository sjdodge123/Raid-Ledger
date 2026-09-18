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
  it('names all three horizons', () => {
    expect(LFG_BOARD_INTRO_BODY).toContain('**Right now**');
    expect(LFG_BOARD_INTRO_BODY).toContain('**Tonight**');
    expect(LFG_BOARD_INTRO_BODY).toContain('**This week**');
  });

  it('explains that Tonight survives a night running past midnight', () => {
    expect(LFG_BOARD_INTRO_BODY).toMatch(/4\s?AM|04:00/);
  });

  it('no longer offers a 30 vs 60 minute choice', () => {
    expect(stripComments(LFG_BOARD_INTRO_BODY)).not.toMatch(
      /30 min|1 hour|60 min/,
    );
  });

  it('still fits inside Discord\'s 2000-character message cap', () => {
    expect(LFG_BOARD_INTRO_TITLE.length).toBeGreaterThan(0);
    expect(LFG_BOARD_INTRO_BODY.length).toBeLessThan(2000);
  });
});
