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
