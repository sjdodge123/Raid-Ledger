import type { CharacterDto, CharacterRole, JoinSeriesDto } from '@raid-ledger/contract';
import { useSignupSelection } from '../use-signup-selection';

/**
 * Character + role picks for the series join, on top of the signup modal's
 * `useSignupSelection` (design Q6): the main character and its role are the
 * defaults, and picking a character resets the roles to that character's.
 */
export function useJoinSeriesSelection(isOpen: boolean, characters: CharacterDto[]) {
    const sel = useSignupSelection(isOpen, characters);
    const selectCharacter = (id: string) => {
        sel.setSelectedCharacterId(id);
        const role = characters.find((c) => c.id === id)?.effectiveRole ?? null;
        sel.setSelectedRoles(role ? [role] : []);
    };
    const toggleRole = (role: CharacterRole) => {
        const roles = sel.selectedRoles;
        sel.setSelectedRoles(roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]);
    };
    const dto: JoinSeriesDto = {
        ...(sel.selectedCharacterId ? { characterId: sel.selectedCharacterId } : {}),
        ...(sel.selectedRoles.length > 0 ? { preferredRoles: sel.selectedRoles } : {}),
    };
    return { characterId: sel.selectedCharacterId, roles: sel.selectedRoles, selectCharacter, toggleRole, dto };
}

export type JoinSeriesSelection = ReturnType<typeof useJoinSeriesSelection>;
