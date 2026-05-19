/**
 * ROK-1330 carrier spec — exercises the contract schemas most likely to
 * change behavior across the zod 3 → 4 migration:
 *
 *  - `z.record(z.string(), z.unknown())` — outer batch shape (was `z.record(value)` in zod 3)
 *  - `z.record(z.unknown())` inside the value union (nested record)
 *  - `.refine()` rejection — the at-least-one-key rule
 *  - `.safeParse()` error shape — `.issues` vs `.errors` access
 *
 * If any of these break shape across the migration the API responses
 * change (clients consume `.flatten().fieldErrors`).
 */
import {
  UpdatePreferenceBatchSchema,
  UpdatePreferenceSchema,
} from '@raid-ledger/contract';

describe('preferences schema — zod 3/4 round-trip', () => {
  describe('UpdatePreferenceBatchSchema', () => {
    it('accepts a record of string keys with mixed primitive values', () => {
      const payload = {
        preferences: {
          theme: 'dark',
          fontSize: 14,
          notifications: true,
        },
      };
      const parsed = UpdatePreferenceBatchSchema.parse(payload);
      expect(parsed.preferences).toEqual(payload.preferences);
    });

    it('accepts nested JSON objects as values (nested z.record(z.unknown()))', () => {
      const payload = {
        preferences: {
          dashboardLayout: {
            columns: ['recent', 'pinned'],
            density: 'compact',
            extra: { nested: { deeply: true } },
          },
        },
      };
      const parsed = UpdatePreferenceBatchSchema.parse(payload);
      expect(parsed.preferences.dashboardLayout).toEqual(
        payload.preferences.dashboardLayout,
      );
    });

    it('accepts arrays as values', () => {
      const payload = {
        preferences: {
          pinnedGames: [101, 202, 303],
        },
      };
      const parsed = UpdatePreferenceBatchSchema.parse(payload);
      expect(parsed.preferences.pinnedGames).toEqual([101, 202, 303]);
    });

    it('rejects empty preferences via .refine()', () => {
      const result = UpdatePreferenceBatchSchema.safeParse({
        preferences: {},
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain('At least one preference is required');
      }
    });

    it('rejects keys that exceed max length', () => {
      const tooLong = 'x'.repeat(101);
      const result = UpdatePreferenceBatchSchema.safeParse({
        preferences: { [tooLong]: 'value' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects values that are not primitives, records, or arrays', () => {
      // null is not in the union; we want it to be rejected so we catch any
      // accidental loosening of the value schema across migration.
      const result = UpdatePreferenceBatchSchema.safeParse({
        preferences: { theme: null },
      });
      expect(result.success).toBe(false);
    });

    it('produces a flatten-able error shape consumed by the API layer', () => {
      const result = UpdatePreferenceBatchSchema.safeParse({
        preferences: {},
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // The lineups + many other controllers do
        // `throw new BadRequestException(parsed.error.flatten().fieldErrors)`
        // — guard the shape so a zod upgrade doesn't silently change it.
        const flattened = result.error.flatten();
        expect(flattened).toHaveProperty('fieldErrors');
        expect(flattened).toHaveProperty('formErrors');
      }
    });
  });

  describe('UpdatePreferenceSchema (single)', () => {
    it('accepts a primitive value', () => {
      const parsed = UpdatePreferenceSchema.parse({
        key: 'theme',
        value: 'dark',
      });
      expect(parsed.value).toBe('dark');
    });

    it('accepts a record value', () => {
      const parsed = UpdatePreferenceSchema.parse({
        key: 'layout',
        value: { columns: 2, density: 'compact' },
      });
      expect(parsed.value).toEqual({ columns: 2, density: 'compact' });
    });

    it('rejects an empty key', () => {
      const result = UpdatePreferenceSchema.safeParse({ key: '', value: 'x' });
      expect(result.success).toBe(false);
    });
  });
});
