/** ROK-2216 U2 — level-fit copy shared by the event page and the hub Dungeon planner. */
import { describe, it, expect } from 'vitest';
import { belowMinCopy, getLevelWarning, levelFitCopy, levelRange } from './level-fit';

describe('levelRange', () => {
    it('reads "Lv15-21", or "Lv15+" with no ceiling', () => {
        expect(levelRange(15, 21)).toBe('Lv15-21');
        expect(levelRange(15, null)).toBe('Lv15+');
        expect(levelRange(15)).toBe('Lv15+');
    });
});

describe('levelFitCopy', () => {
    it('in range shows the range with a tick', () => {
        expect(levelFitCopy('in', 15, 21)).toBe('Lv15-21 ✓');
    });
    it('below reads exactly like the event page warning', () => {
        expect(levelFitCopy('below', 15, 21)).toBe('Below min level (15)');
        expect(belowMinCopy(15)).toBe('Below min level (15)');
    });
    it('above is neutral "Above range (max N)"', () => {
        expect(levelFitCopy('above', 15, 21)).toBe('Above range (max 21)');
    });
    it('unknown reads "Level unknown"', () => {
        expect(levelFitCopy('unknown', 15, 21)).toBe('Level unknown');
    });
});

describe('getLevelWarning (event page wording unchanged)', () => {
    const inst = (minimumLevel: number): { minimumLevel: number } => ({ minimumLevel });

    it('keeps "Below min level (N)"', () => {
        expect(getLevelWarning(10, [inst(15)], 'world-of-warcraft-classic')).toEqual({ type: 'under', label: 'Below min level (15)' });
    });
    it('keeps the Classic-only "Over-leveled for this content"', () => {
        expect(getLevelWarning(40, [inst(15)], 'world-of-warcraft-classic')).toEqual({ type: 'over', label: 'Over-leveled for this content' });
        expect(getLevelWarning(40, [inst(15)], 'world-of-warcraft')).toBeNull();
    });
});
