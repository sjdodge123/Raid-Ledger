/**
 * ROK-1559 — the one place templates (0 = Monday) become grid cells
 * (0 = Sunday). Both the events and the scheduling-poll aggregates call this.
 */
import {
  aggregateTemplatesToCells,
  templateDayToGridDay,
} from './game-time-heatmap.helpers';

describe('templateDayToGridDay (ROK-1559)', () => {
  it('maps a Monday template (0) to grid column 1', () => {
    expect(templateDayToGridDay(0)).toBe(1);
  });

  it('maps a Sunday template (6) to grid column 0', () => {
    expect(templateDayToGridDay(6)).toBe(0);
  });

  it('maps every template day onto a distinct grid column', () => {
    const cols = [0, 1, 2, 3, 4, 5, 6].map(templateDayToGridDay);
    expect([...cols].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('aggregateTemplatesToCells (ROK-1559)', () => {
  it('counts templates per remapped day×hour cell against totalUsers', () => {
    const cells = aggregateTemplatesToCells(
      [
        { dayOfWeek: 0, startHour: 20 }, // Monday 20:00
        { dayOfWeek: 0, startHour: 20 }, // another member, same cell
        { dayOfWeek: 6, startHour: 9 }, // Sunday 09:00
      ],
      3,
    );
    expect(cells).toEqual(
      expect.arrayContaining([
        { dayOfWeek: 1, hour: 20, availableCount: 2, totalCount: 3 },
        { dayOfWeek: 0, hour: 9, availableCount: 1, totalCount: 3 },
      ]),
    );
    expect(cells).toHaveLength(2);
  });

  it('returns no cells for no templates', () => {
    expect(aggregateTemplatesToCells([], 4)).toEqual([]);
  });
});
