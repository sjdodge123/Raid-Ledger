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
    return error instanceof Error && error.message
        ? error.message
        : "Couldn't claim this character";
}

function useClaimFlow(character: ValheimCharacterSummary) {
    const [open, setOpen] = useState(false);
    const claim = useClaimCharacter(character.id);
    const close = () => setOpen(false);
    const confirm = () =>
        claim.mutate(undefined, {
            onSuccess: () => {
                close();
                toast.success(`${character.name} is now yours.`);
            },
            onError: (error) => {
                close();
                toast.error(claimErrorText(error));
            },
        });
    return {
        open,
        show: () => setOpen(true),
        close,
        confirm,
        pending: claim.isPending,
    };
}

function ConfirmFooter({
    onCancel,
    onConfirm,
    pending,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    pending: boolean;
}) {
    return (
        <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={onConfirm}
                loading={pending}
                loadingLabel="Claiming…"
            >
                Claim
            </Button>
        </div>
    );
}

interface ClaimCharacterButtonProps {
    character: ValheimCharacterSummary;
}

export function ClaimCharacterButton({ character }: ClaimCharacterButtonProps) {
    const flow = useClaimFlow(character);
    const footer = (
        <ConfirmFooter
            onCancel={flow.close}
            onConfirm={flow.confirm}
            pending={flow.pending}
        />
    );
    return (
        <>
            <Button variant="primary" onClick={flow.show}>
                Claim this character
            </Button>
            <OwnerDialog
                isOpen={flow.open}
                onClose={flow.close}
                title="Claim character"
                footer={footer}
            >
                <p className="text-sm text-foreground">
                    Claim {character.name} as yours? An admin can change this.
                </p>
            </OwnerDialog>
        </>
    );
}
