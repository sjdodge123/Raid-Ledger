/**
 * ROK-1836 L4 — the header's owner actions for the viewer: a signed-in
 * member sees Claim on an unclaimed character, an admin also sees Change
 * owner; a signed-out visitor sees neither.
 */
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { isAdmin, type User } from '../../../hooks/use-auth';
import { ClaimCharacterButton } from './claim-character-button';
import { ChangeOwnerSheet } from './change-owner-sheet';

interface Props {
    character: ValheimCharacterSummary;
    viewer: User | null;
}

export function ValheimCharacterOwnerActions({ character, viewer }: Props) {
    if (viewer === null) return null;
    return (
        <>
            {character.claimedBy === null && <ClaimCharacterButton character={character} />}
            {isAdmin(viewer) && <ChangeOwnerSheet character={character} />}
        </>
    );
}
