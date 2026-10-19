/** ROK-1836 L4 (D10) — admin "Change owner": member search, Assign, Remove owner, claim history. */
import { useState } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { toast } from '../../../lib/toast';
import { useAssignOwner, useClaimEvents } from '../hooks/use-valheim-claims';
import { ClaimHistory } from './claim-history';
import { OwnerDialog } from './owner-dialog';
import { OwnerSearch, type OwnerOption } from './owner-search';

function errorText(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "Couldn't change the owner";
}

function useOwnerChange(character: ValheimCharacterSummary, onDone: () => void) {
    const assign = useAssignOwner(character.id);
    const run = (pick: OwnerOption | null) => assign.mutate(pick?.id ?? null, {
        onSuccess: () => {
            onDone();
            toast.success(pick ? `${character.name} now belongs to ${pick.username}.` : `${character.name} is unclaimed.`);
        },
        onError: (error) => toast.error(errorText(error)),
    });
    return { run, pending: assign.isPending };
}

function Footer({ canRemove, pick, pending, onRemove, onCancel, onAssign }: {
    canRemove: boolean; pick: OwnerOption | null; pending: boolean;
    onRemove: () => void; onCancel: () => void; onAssign: () => void;
}) {
    return (
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="destructive" onClick={onRemove} disabled={!canRemove || pending}>Remove owner</Button>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onAssign} disabled={pick === null} loading={pending} loadingLabel="Assigning…">Assign</Button>
        </div>
    );
}

export function ChangeOwnerSheet({ character }: { character: ValheimCharacterSummary }) {
    const [open, setOpen] = useState(false);
    const [pick, setPick] = useState<OwnerOption | null>(null);
    const close = () => { setOpen(false); setPick(null); };
    const change = useOwnerChange(character, close);
    const events = useClaimEvents(character.id, open);
    const current = character.claimedBy?.username ?? 'unclaimed';
    const footer = (
        <Footer canRemove={character.claimedBy !== null} pick={pick} pending={change.pending}
            onRemove={() => change.run(null)} onCancel={close} onAssign={() => { if (pick) change.run(pick); }} />
    );
    return (
        <>
            <Button variant="secondary" onClick={() => setOpen(true)}>Change owner</Button>
            <OwnerDialog isOpen={open} onClose={close} title="Change owner" footer={footer}>
                <p className="mb-3 text-sm text-muted">{character.name} · currently {current}</p>
                <OwnerSearch value={pick} onChange={setPick} />
                <ClaimHistory events={events.data} isError={events.isError} />
            </OwnerDialog>
        </>
    );
}
