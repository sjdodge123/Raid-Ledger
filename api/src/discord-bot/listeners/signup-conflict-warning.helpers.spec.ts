/**
 * TDD tests for signup conflict warning helper (ROK-1031).
 * Tests buildConflictWarning() which formats a conflict warning
 * string for Discord ephemeral replies.
 */
import { buildConflictWarning } from './signup-conflict-warning.helpers';
import type { ConflictingEvent } from '../../events/event-conflict.helpers';

function buildConflict(
  title: string,
  start = '2026-05-01T17:00:00Z',
  end = '2026-05-01T19:00:00Z',
): ConflictingEvent {
  return {
    id: 1,
    title,
    duration: [new Date(start), new Date(end)],
    cancelledAt: null,
  };
}

describe('buildConflictWarning', () => {
  it('returns empty string when no conflicts exist', () => {
    expect(buildConflictWarning([])).toBe('');
  });

  it('returns warning with single conflict title in bold', () => {
    const conflicts = [buildConflict('Raid Night')];
    const result = buildConflictWarning(conflicts);

    expect(result).toContain('Raid Night');
    expect(result).toContain('**Raid Night**');
    expect(result).toMatch(/⚠️/);
  });

  it('returns warning listing multiple conflict titles', () => {
    const conflicts = [
      buildConflict('Raid Night'),
      buildConflict('Dungeon Run'),
    ];
    const result = buildConflictWarning(conflicts);

    expect(result).toContain('**Raid Night**');
    expect(result).toContain('**Dungeon Run**');
  });

  it('starts with newline for appending to existing message', () => {
    const conflicts = [buildConflict('Raid Night')];
    const result = buildConflictWarning(conflicts);

    expect(result.startsWith('\n')).toBe(true);
  });
});
