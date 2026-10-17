import { derivePreferredRoles } from './signup-role-derive.helpers';

describe('derivePreferredRoles', () => {
  it('returns roleOverride when both role and roleOverride are set', () => {
    const result = derivePreferredRoles({ role: 'dps', roleOverride: 'tank' });
    expect(result).toEqual(['tank']);
  });

  it('falls back to role when roleOverride is null', () => {
    const result = derivePreferredRoles({ role: 'healer', roleOverride: null });
    expect(result).toEqual(['healer']);
  });

  it('returns undefined when both role and roleOverride are null', () => {
    const result = derivePreferredRoles({ role: null, roleOverride: null });
    expect(result).toBeUndefined();
  });

  it('uses role when roleOverride is undefined', () => {
    const result = derivePreferredRoles({
      role: 'dps',
      roleOverride: undefined as unknown as null,
    });
    expect(result).toEqual(['dps']);
  });
});

describe('derivePreferredRoles — adversarial edge cases (ROK-775)', () => {
  it('returns roleOverride when role is null but roleOverride is set', () => {
    const result = derivePreferredRoles({ role: null, roleOverride: 'healer' });
    expect(result).toEqual(['healer']);
  });

  it('returns undefined when role is undefined and roleOverride is null', () => {
    const result = derivePreferredRoles({
      role: undefined as unknown as null,
      roleOverride: null,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when both fields are undefined', () => {
    const result = derivePreferredRoles({
      role: undefined as unknown as null,
      roleOverride: undefined as unknown as null,
    });
    expect(result).toBeUndefined();
  });

  it('always returns a single-element array, never multi-element', () => {
    const result = derivePreferredRoles({ role: 'dps', roleOverride: null });
    expect(result).toHaveLength(1);
  });

  it.each(['tank', 'healer', 'dps'] as const)(
    'wraps %s role in an array',
    (role) => {
      const result = derivePreferredRoles({ role, roleOverride: null });
      expect(result).toEqual([role]);
    },
  );

  it.each(['tank', 'healer', 'dps'] as const)(
    'wraps %s roleOverride in an array',
    (roleOverride) => {
      const result = derivePreferredRoles({ role: 'dps', roleOverride });
      expect(result).toEqual([roleOverride]);
    },
  );
});
