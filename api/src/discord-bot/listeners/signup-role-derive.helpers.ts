import type { CharacterDto } from '@raid-ledger/contract';

/**
 * Derive preferredRoles from a character's effective role.
 * Returns undefined when role is null/undefined (no preference).
 */
export function derivePreferredRoles(
  char: Pick<CharacterDto, 'role' | 'roleOverride'>,
): ('tank' | 'healer' | 'dps')[] | undefined {
  const role = char.roleOverride ?? char.role;
  return role ? [role] : undefined;
}
