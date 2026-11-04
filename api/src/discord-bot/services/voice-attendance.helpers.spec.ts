/**
 * Unit tests for voice-attendance.helpers.ts (ROK-785).
 * Covers the parseGraceMinutes pure function extracted in this fix.
 */
import { parseGraceMinutes } from './voice-attendance.helpers';

describe('parseGraceMinutes', () => {
  describe('valid numeric strings', () => {
    it('parses a standard grace period string', () => {
      expect(parseGraceMinutes('10')).toBe(10);
    });

    it('parses the default-like value "5"', () => {
      expect(parseGraceMinutes('5')).toBe(5);
    });

    it('parses "0" as zero (not the default)', () => {
      // Zero is a valid configuration — no grace window.
      expect(parseGraceMinutes('0')).toBe(0);
    });

    it('parses a large value correctly', () => {
      expect(parseGraceMinutes('60')).toBe(60);
    });

    it('truncates decimal strings via parseInt (does not round)', () => {
      // parseInt('7.9') === 7, not 8
      expect(parseGraceMinutes('7.9')).toBe(7);
    });

    it('parses string with leading whitespace (parseInt behaviour)', () => {
      // parseInt handles leading spaces
      expect(parseGraceMinutes('  3')).toBe(3);
    });
  });

  describe('clamping to 0–60 (ROK-1940)', () => {
    it('clamps a negative value up to 0', () => {
      // Intentional behaviour change: previously returned -1 unclamped.
      expect(parseGraceMinutes('-1')).toBe(0);
    });

    it('keeps 60 and clamps a value above 60 down to 60', () => {
      expect(parseGraceMinutes('60')).toBe(60);
      expect(parseGraceMinutes('61')).toBe(60);
      expect(parseGraceMinutes('999')).toBe(60);
    });
  });

  describe('null and invalid inputs — fall back to default 5', () => {
    it('returns 5 when value is null', () => {
      expect(parseGraceMinutes(null)).toBe(5);
    });

    it('returns 5 for non-numeric string', () => {
      expect(parseGraceMinutes('abc')).toBe(5);
    });

    it('returns 5 for empty string', () => {
      // parseInt('') === NaN → default
      expect(parseGraceMinutes('')).toBe(5);
    });

    it('returns 5 for whitespace-only string', () => {
      // parseInt('   ') === NaN → default
      expect(parseGraceMinutes('   ')).toBe(5);
    });

    it('returns 5 for "NaN" string literal', () => {
      expect(parseGraceMinutes('NaN')).toBe(5);
    });

    it('returns 5 for a float-only string with no integer part', () => {
      // parseInt('.5') === NaN → default
      expect(parseGraceMinutes('.5')).toBe(5);
    });
  });

  describe('boundary: exactly 0 is not the default', () => {
    it('returns 0 for "0" — zero is distinct from null/NaN default', () => {
      const result = parseGraceMinutes('0');
      expect(result).toBe(0);
      expect(result).not.toBe(5);
    });
  });
});
