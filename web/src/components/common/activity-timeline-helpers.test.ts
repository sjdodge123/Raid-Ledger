import { describe, expect, it } from 'vitest';
import { getActionDisplay } from './activity-timeline-helpers';

// ROK-1443 (T6): the new timeline row, and the graceful fallback the api-side
// spec relies on for any action the web has not learned yet.
describe('getActionDisplay', () => {
  it('renders lineup_deadline_extended as an amber row with its own label', () => {
    const display = getActionDisplay('lineup_deadline_extended');
    expect(display.color).toBe('text-amber-400');
    expect(display.label(null, null)).toBe(
      'Deadline extended — nobody nominated yet',
    );
  });

  it('degrades an unknown action to the muted Activity fallback', () => {
    const display = getActionDisplay('totally_unknown' as never);
    expect(display.color).toBe('text-muted');
    expect(display.label(null, null)).toBe('Activity');
  });
});
