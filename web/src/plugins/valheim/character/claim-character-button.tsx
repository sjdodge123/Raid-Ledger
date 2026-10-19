/** ROK-1836 L4 (D9) — "Claim this character" + one-step confirm; 409 = someone claimed first. */
import { useState } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { toast } from '../../../lib/toast';
import { useClaimCharacter } from '../hooks/use-valheim-claims';
import { isConflictError } from '../lib/valheim-armory-claims-api';
import { OwnerDialog } from './owner-dialog';

function claimErrorText(error: unknown): string {
    if (isConflictError(error)) return 'Someone claimed this first';
    return error instanceof Error && error.message ? error.message : "Couldn't claim this character";
}

export function ClaimCharacterButton({ character }: { character: ValheimCharacterSummary }) {
    const [open, setOpen] = useState(false);
    const claim = useClaimCharacter(character.id);
    const close = () => setOpen(false);
    const confirm = () => claim.mutate(undefined, {
        onSuccess: () => { close(); toast.success(`${character.name} is now yours.`); },
        onError: (error) => { close(); toast.error(claimErrorText(error)); },
    });
    const footer = (
        <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={confirm} loading={claim.isPending} loadingLabel="Claiming…">Claim</Button>
        </div>
    );
    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>Claim this character</Button>
            <OwnerDialog isOpen={open} onClose={close} title="Claim character" footer={footer}>
                <p className="text-sm text-foreground">Claim {character.name} as yours? An admin can change this.</p>
            </OwnerDialog>
        </>
    );
}
