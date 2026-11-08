/**
 * ROK-2128 (D6) — admin "Change owner" for a WoW character on the character
 * page: a `MemberCombobox` in a `Field`, Assign (primary), Cancel, and the
 * Unlink hand-off the wireframe puts in the same footer. Rendered by
 * `CharacterDetailAdminActions`, which core shows to admins only.
 */
import { useState, type JSX } from 'react';
import { UserIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Modal } from '../../../components/ui/modal';
import { MemberCombobox, type MemberOption } from '../../../components/shared/member-combobox';
import { useUserProfile } from '../../../hooks/use-user-profile';
import { toast } from '../../../lib/toast';
import { useChangeCharacterOwner } from '../hooks/use-change-character-owner';

interface CharacterChangeOwnerProps {
    characterId: string;
    name: string;
    ownerId: number | undefined;
    /** Closes this dialog and opens the Unlink confirm. */
    onUnlink: () => void;
}

interface OwnerFooterProps {
    pick: MemberOption | null;
    pending: boolean;
    onUnlink: () => void;
    onCancel: () => void;
    onAssign: () => void;
}

function OwnerFooter({ pick, pending, onUnlink, onCancel, onAssign }: OwnerFooterProps): JSX.Element {
    return (
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="destructive-soft" onClick={onUnlink} disabled={pending}>Unlink</Button>
            <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
            <Button variant="primary" onClick={onAssign} disabled={pick === null} loading={pending} loadingLabel="Assigning…">
                Assign
            </Button>
        </div>
    );
}

/** The confirm line names both users once a new owner is picked. */
function ownerHint(name: string, owner: string, pick: MemberOption | null): string {
    const move = pick ? `Moves ${name} from ${owner} to ${pick.username}. ` : '';
    return `${move}Both players get a notification. Future sign-ups by ${owner} lose this character.`;
}

/** Dialog state + the Assign mutation; a success closes the dialog and toasts the new owner. */
function useChangeOwnerFlow(characterId: string, name: string) {
    const [open, setOpen] = useState(false);
    const [pick, setPick] = useState<MemberOption | null>(null);
    const change = useChangeCharacterOwner();
    const close = (): void => { if (!change.isPending) { setOpen(false); setPick(null); } };
    const assign = (): void => {
        if (!pick) return;
        change.mutate({ characterId, userId: pick.id }, {
            onSuccess: () => { setOpen(false); setPick(null); toast.success(`${name} now belongs to ${pick.username}.`); },
            onError: (error: Error) => toast.error(error.message || `Couldn't change the owner of ${name}.`),
        });
    };
    return { open, setOpen, pick, setPick, close, assign, pending: change.isPending };
}

/** Admin-only trigger + dialog that reassigns a WoW character to another member. */
export function CharacterChangeOwner({ characterId, name, ownerId, onUnlink }: CharacterChangeOwnerProps): JSX.Element {
    const { open, setOpen, pick, setPick, close, assign, pending } = useChangeOwnerFlow(characterId, name);
    const owner = useUserProfile(open ? ownerId : undefined).data?.username ?? 'the current owner';
    const unlink = (): void => { close(); onUnlink(); };
    return (
        <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <UserIcon className="w-4 h-4" aria-hidden="true" />
                Change owner
            </Button>
            <Modal isOpen={open} onClose={close} title={`Change owner of ${name}`}
                footer={<OwnerFooter pick={pick} pending={pending} onUnlink={unlink} onCancel={close} onAssign={assign} />}>
                <p className="mb-3 text-sm text-muted">Owned by <strong className="text-foreground">{owner}</strong></p>
                <div className="min-h-[21rem]">
                    <Field label="New owner" required hint={ownerHint(name, owner, pick)}>
                        <MemberCombobox value={pick} onChange={setPick} />
                    </Field>
                </div>
            </Modal>
        </>
    );
}
