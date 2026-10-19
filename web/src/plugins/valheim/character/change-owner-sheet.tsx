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
    return error instanceof Error && error.message
        ? error.message
        : "Couldn't change the owner";
}

function successText(name: string, pick: OwnerOption | null): string {
    return pick
        ? `${name} now belongs to ${pick.username}.`
        : `${name} is unclaimed.`;
}

function useChangeOwner(character: ValheimCharacterSummary) {
    const [open, setOpen] = useState(false);
    const [pick, setPick] = useState<OwnerOption | null>(null);
    const assign = useAssignOwner(character.id);
    const close = () => {
        setOpen(false);
        setPick(null);
    };
    const run = (target: OwnerOption | null) =>
        assign.mutate(target?.id ?? null, {
            onSuccess: () => {
                close();
                toast.success(successText(character.name, target));
            },
            onError: (error) => toast.error(errorText(error)),
        });
    return {
        open,
        show: () => setOpen(true),
        close,
        pick,
        setPick,
        run,
        pending: assign.isPending,
    };
}

type Flow = ReturnType<typeof useChangeOwner>;

function OwnerFooter({ flow, canRemove }: { flow: Flow; canRemove: boolean }) {
    const assign = () => flow.pick && flow.run(flow.pick);
    return (
        <div className="flex flex-wrap justify-end gap-2">
            <Button
                variant="destructive"
                onClick={() => flow.run(null)}
                disabled={!canRemove || flow.pending}
            >
                Remove owner
            </Button>
            <Button variant="secondary" onClick={flow.close}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={assign}
                disabled={flow.pick === null}
                loading={flow.pending}
                loadingLabel="Assigning…"
            >
                Assign
            </Button>
        </div>
    );
}

interface ChangeOwnerSheetProps {
    character: ValheimCharacterSummary;
}

export function ChangeOwnerSheet({ character }: ChangeOwnerSheetProps) {
    const flow = useChangeOwner(character);
    const events = useClaimEvents(character.id, flow.open);
    const footer = (
        <OwnerFooter flow={flow} canRemove={character.claimedBy !== null} />
    );
    return (
        <>
            <Button variant="secondary" onClick={flow.show}>
                Change owner
            </Button>
            <OwnerDialog
                isOpen={flow.open}
                onClose={flow.close}
                title="Change owner"
                footer={footer}
            >
                <p className="mb-3 text-sm text-muted">
                    {character.name} · currently{' '}
                    {character.claimedBy?.username ?? 'unclaimed'}
                </p>
                <OwnerSearch value={flow.pick} onChange={flow.setPick} />
                <ClaimHistory events={events.data} isError={events.isError} />
            </OwnerDialog>
        </>
    );
}
