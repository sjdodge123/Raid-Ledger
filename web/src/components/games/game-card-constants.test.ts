/**
 * Adversarial unit tests for game-card-constants (ROK-805).
 * Covers getRatingClasses boundary values and HEART_PATH shape.
 */
import { describe, it, expect } from 'vitest';
import {
    getRatingClasses,
    HEART_PATH,
} from './game-card-constants';

// ── getRatingClasses — boundary conditions ────────────────────────────────────

describe('getRatingClasses — green tier (>= 75)', () => {
    it('returns green classes for rating exactly 75', () => {
        expect(getRatingClasses(75)).toBe('bg-emerald-500/90 text-white');
    });

    it('returns green classes for rating 100', () => {
        expect(getRatingClasses(100)).toBe('bg-emerald-500/90 text-white');
    });

    it('returns green classes for rating 76', () => {
        expect(getRatingClasses(76)).toBe('bg-emerald-500/90 text-white');
    });
});

describe('getRatingClasses — yellow tier (>= 50, < 75)', () => {
    it('returns yellow classes for rating exactly 50', () => {
        expect(getRatingClasses(50)).toBe('bg-yellow-500/90 text-black');
    });

    it('returns yellow classes for rating 74', () => {
        expect(getRatingClasses(74)).toBe('bg-yellow-500/90 text-black');
    });

    it('returns yellow classes for rating 74.9 (below green threshold)', () => {
        expect(getRatingClasses(74.9)).toBe('bg-yellow-500/90 text-black');
    });

    it('returns yellow classes for rating 60', () => {
        expect(getRatingClasses(60)).toBe('bg-yellow-500/90 text-black');
    });
});

describe('getRatingClasses — red tier (< 50)', () => {
    it('returns red classes for rating 49', () => {
        expect(getRatingClasses(49)).toBe('bg-red-500/90 text-white');
    });

    it('returns red classes for rating 0', () => {
        expect(getRatingClasses(0)).toBe('bg-red-500/90 text-white');
    });

    it('returns red classes for rating 49.9 (below yellow threshold)', () => {
        expect(getRatingClasses(49.9)).toBe('bg-red-500/90 text-white');
    });

    it('returns red classes for negative rating', () => {
        // Defensive: negative ratings should fall through to red
        expect(getRatingClasses(-1)).toBe('bg-red-500/90 text-white');
    });
});

// ── MODE_MAP removed (ROK-1314) ─────────────────────────────────────────────
// MODE_MAP lived here only for the InfoBar's mode label, which is deleted: it
// read `MODE_MAP[gameModes[0]]`, and IGDB orders game_modes by ascending id, so
// it printed "Single" for any game with a single-player component. The game
// DETAIL page keeps its own separate MODE_MAP (`game-detail-constants.ts`,
// still tested there) and maps the WHOLE array, which is correct.
// ── HEART_PATH — is a non-empty SVG path string ───────────────────────────────

describe('HEART_PATH', () => {
    it('is a non-empty string', () => {
        expect(typeof HEART_PATH).toBe('string');
        expect(HEART_PATH.length).toBeGreaterThan(0);
    });

    it('starts with a valid SVG path command', () => {
        // SVG paths start with a letter command like M, L, C, etc.
        expect(HEART_PATH[0]).toMatch(/[MLCQAZmlcqaz]/);
    });
});
