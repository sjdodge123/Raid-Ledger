/**
 * Character + role selection shared by the signup confirmation modal and the
 * series join overlay (ROK-1728, design Q6). Moved out of
 * `signup-confirmation-modal.tsx` unchanged so both can import it.
 */
import { useState, useEffect, useMemo } from 'react';
import type { CharacterDto, CharacterRole } from '@raid-ledger/contract';

function resolveDefaultRole(characters: CharacterDto[], charId: string | null, preSelectedRole?: CharacterRole) {
    if (preSelectedRole) return { role: preSelectedRole, roles: [preSelectedRole] };
    const defaultChar = characters.find((c) => c.id === charId);
    const role = (defaultChar?.effectiveRole as CharacterRole) ?? null;
    return { role, roles: role ? [role] : [] };
}

function useSignupSelectionReset(
    sessionKey: number, defaultCharacterId: string | null, characters: CharacterDto[], preSelectedRole: CharacterRole | undefined,
    setSelectedCharacterId: React.Dispatch<React.SetStateAction<string | null>>, setSelectedRole: (v: CharacterRole | null) => void,
    setSelectedRoles: (v: CharacterRole[]) => void, setShowCreateForm: (v: boolean) => void,
) {
    useEffect(() => {
        setSelectedCharacterId(defaultCharacterId);
        setShowCreateForm(false);
        const { role, roles } = resolveDefaultRole(characters, defaultCharacterId, preSelectedRole);
        setSelectedRole(role); setSelectedRoles(roles);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    useEffect(() => {
        if (!defaultCharacterId) return;
        setSelectedCharacterId((prev) => {
            if (prev) return prev;
            const { role, roles } = resolveDefaultRole(characters, defaultCharacterId, preSelectedRole);
            setSelectedRole(role); setSelectedRoles(roles);
            return defaultCharacterId;
        });
    }, [defaultCharacterId, preSelectedRole, characters, setSelectedCharacterId, setSelectedRole, setSelectedRoles]);
}

/** Character + role selection for a signup overlay; reset each time it opens. Shared with the series join (ROK-1728). */
export function useSignupSelection(isOpen: boolean, characters: CharacterDto[], preSelectedRole?: CharacterRole) {
    const mainCharacter = characters.find((c) => c.isMain);
    const [sessionKey, setSessionKey] = useState(0);
    const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<CharacterRole | null>(null);
    const [selectedRoles, setSelectedRoles] = useState<CharacterRole[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    if (isOpen && !prevIsOpen) { setPrevIsOpen(true); setSessionKey((k) => k + 1); }
    if (!isOpen && prevIsOpen) { setPrevIsOpen(false); }
    const defaultCharacterId = useMemo(() => mainCharacter?.id ?? null, [mainCharacter?.id]);
    useSignupSelectionReset(sessionKey, defaultCharacterId, characters, preSelectedRole, setSelectedCharacterId, setSelectedRole, setSelectedRoles, setShowCreateForm);

    return {
        selectedCharacterId, setSelectedCharacterId,
        selectedRole, setSelectedRole,
        selectedRoles, setSelectedRoles,
        showCreateForm, setShowCreateForm,
    };
}
