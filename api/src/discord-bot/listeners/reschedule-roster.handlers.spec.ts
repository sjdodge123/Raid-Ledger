/**
 * Tests for ROK-548: buildUpdateSet must filter non-MMO roles from
 * preferredRoles and only wrap slotRole when it is an MMO role.
 */
import { buildUpdateSet } from './reschedule-roster.handlers';
import type { ReconfirmOptions } from './reschedule-response.helpers';

describe('buildUpdateSet — ROK-548 preferredRoles filtering', () => {
  describe('preferredRoles array filtering', () => {
    it('keeps only MMO roles from preferredRoles', () => {
      const opts: ReconfirmOptions = {
        preferredRoles: ['tank', 'healer', 'dps'],
      };
      const result = buildUpdateSet(opts);
      expect(result.preferredRoles).toEqual(['tank', 'healer', 'dps']);
    });

    it('filters out non-MMO roles from preferredRoles', () => {
      const optsWithBadRoles = {
        preferredRoles: ['tank', 'player' as never],
      };
      const result = buildUpdateSet(optsWithBadRoles as ReconfirmOptions);
      expect(result.preferredRoles).toEqual(['tank']);
    });

    it('filters all entries when preferredRoles are all non-MMO', () => {
      const opts = {
        preferredRoles: ['player', 'flex'] as never,
      } as ReconfirmOptions;
      const result = buildUpdateSet(opts);
      expect(result.preferredRoles).toEqual([]);
    });

    it('returns empty array when preferredRoles has bench only', () => {
      const opts = {
        preferredRoles: ['bench'] as never,
      } as ReconfirmOptions;
      const result = buildUpdateSet(opts);
      expect(result.preferredRoles).toEqual([]);
    });
  });

  describe('slotRole wrapping to preferredRoles', () => {
    it('wraps slotRole when it is an MMO role', () => {
      const result = buildUpdateSet({ slotRole: 'tank' });
      expect(result.preferredRoles).toEqual(['tank']);
    });

    it('wraps slotRole healer', () => {
      const result = buildUpdateSet({ slotRole: 'healer' });
      expect(result.preferredRoles).toEqual(['healer']);
    });

    it('wraps slotRole dps', () => {
      const result = buildUpdateSet({ slotRole: 'dps' });
      expect(result.preferredRoles).toEqual(['dps']);
    });

    it('does NOT wrap slotRole when it is player', () => {
      const result = buildUpdateSet({ slotRole: 'player' });
      expect(result.preferredRoles).toBeUndefined();
    });

    it('does NOT wrap slotRole when it is flex', () => {
      const result = buildUpdateSet({ slotRole: 'flex' });
      expect(result.preferredRoles).toBeUndefined();
    });

    it('does NOT wrap slotRole when it is bench', () => {
      const result = buildUpdateSet({ slotRole: 'bench' });
      expect(result.preferredRoles).toBeUndefined();
    });
  });

  describe('base fields', () => {
    it('sets status to signed_up by default', () => {
      const result = buildUpdateSet({});
      expect(result.status).toBe('signed_up');
    });

    it('sets status to tentative when signupStatus is tentative', () => {
      const result = buildUpdateSet({ signupStatus: 'tentative' });
      expect(result.status).toBe('tentative');
    });

    it('always sets confirmationStatus to confirmed', () => {
      const result = buildUpdateSet({});
      expect(result.confirmationStatus).toBe('confirmed');
    });

    it('always clears roachedOutAt', () => {
      const result = buildUpdateSet({});
      expect(result.roachedOutAt).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles undefined options', () => {
      const result = buildUpdateSet(undefined);
      expect(result.preferredRoles).toBeUndefined();
      expect(result.status).toBe('signed_up');
    });

    it('preferredRoles takes precedence over slotRole', () => {
      const result = buildUpdateSet({
        preferredRoles: ['healer', 'dps'],
        slotRole: 'tank',
      });
      // preferredRoles branch fires first, slotRole ignored
      expect(result.preferredRoles).toEqual(['healer', 'dps']);
    });
  });
});
