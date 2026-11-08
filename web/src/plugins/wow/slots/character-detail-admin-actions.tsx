/**
 * WoW plugin filler for the core `character-detail:admin-actions` slot:
 * "Change owner" (ROK-2128) and "Unlink character" (ROK-1756) for a character
 * linked to an in-game roster row — a LedgerLink GUID (`addonLinked`) or a
 * roster pick (`rosterClaimed`). Core renders the slot for admins only; this
 * self-filters to linked characters, and the API re-checks both (AdminGuard).
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { LinkSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { toast } from '../../../lib/toast';
import { useUnlinkAddonCharacter } from '../hooks/use-unlink-addon-character';
import { CharacterChangeOwner } from './character-change-owner';

interface CharacterDetailAdminActionsProps {
    characterId: string;
    name: string;
    /** Current owner's user id (names them in the Change owner dialog). */
    userId?: number | undefined;
    addonLinked?: boolean | undefined;
    /** ROK-2128: claimed from a guild roster (may have no GUID). */
    rosterClaimed?: boolean | undefined;
}

function UnlinkFooter({ onCancel, onConfirm, isPending }: { onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
    return (
        <>
            <Button variant="secondary" onClick={onCancel} disabled={isPending}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirm} loading={isPending} loadingLabel="Deleting...">
                Delete character
            </Button>
        </>
    );
}

interface UnlinkConfirmProps {
    characterId: string;
    name: string;
    open: boolean;
    setOpen: (open: boolean) => void;
}

/** The destructive confirm: deletes the character so the roster row is free again. */
function UnlinkConfirm({ characterId, name, open, setOpen }: UnlinkConfirmProps): JSX.Element {
    const navigate = useNavigate();
    const unlink = useUnlinkAddonCharacter();
    const confirm = () => unlink.mutate(characterId, {
        onSuccess: (result) => {
            setOpen(false);
            toast.success(`${name} was unlinked and deleted.`);
            navigate(`/users/${result.userId}`, { replace: true });
        },
        onError: (error: Error) => toast.error(error.message || `Couldn't unlink ${name}.`),
    });
    return (
        <Modal isOpen={open} onClose={() => { if (!unlink.isPending) setOpen(false); }} title={`Unlink ${name}?`}
            footer={<UnlinkFooter onCancel={() => setOpen(false)} onConfirm={confirm} isPending={unlink.isPending} />}>
            <p className="text-secondary">
                This deletes <strong className="text-foreground">{name}</strong> and all of its imported data
                (gear, talents, quests). The in-game character is freed so its rightful owner can re-import or
                claim it. This can&apos;t be undone.
            </p>
        </Modal>
    );
}

/** Admin actions for a roster-linked WoW character; renders nothing for any other character. */
export function CharacterDetailAdminActions({ characterId, name, userId, addonLinked, rosterClaimed }: CharacterDetailAdminActionsProps) {
    const [unlinkOpen, setUnlinkOpen] = useState(false);
    if (addonLinked !== true && rosterClaimed !== true) return null;
    return (
        <>
            <CharacterChangeOwner characterId={characterId} name={name} ownerId={userId} onUnlink={() => setUnlinkOpen(true)} />
            <Button variant="destructive-soft" size="sm" onClick={() => setUnlinkOpen(true)}>
                <LinkSlashIcon className="w-4 h-4" aria-hidden="true" />
                Unlink character
            </Button>
            <UnlinkConfirm characterId={characterId} name={name} open={unlinkOpen} setOpen={setUnlinkOpen} />
        </>
    );
}
