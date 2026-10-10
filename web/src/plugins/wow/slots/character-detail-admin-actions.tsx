/**
 * WoW plugin filler for the core `character-detail:admin-actions` slot
 * (ROK-1756): "Unlink character" for a LedgerLink GUID-linked character.
 * Core renders the slot for admins only; this self-filters to
 * `addonLinked`, and the API re-checks both (AdminGuard, 409 without a GUID).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LinkSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { toast } from '../../../lib/toast';
import { useUnlinkAddonCharacter } from '../hooks/use-unlink-addon-character';

interface CharacterDetailAdminActionsProps {
    characterId: string;
    name: string;
    addonLinked?: boolean | undefined;
}

function UnlinkFooter({ onCancel, onConfirm, isPending }: { onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirm} loading={isPending} loadingLabel="Unlinking...">
                Delete character
            </Button>
        </>
    );
}

export function CharacterDetailAdminActions({ characterId, name, addonLinked }: CharacterDetailAdminActionsProps) {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const unlink = useUnlinkAddonCharacter();
    if (addonLinked !== true) return null;

    const confirm = () => unlink.mutate(characterId, {
        onSuccess: (result) => {
            setOpen(false);
            toast.success(`${name} was unlinked and deleted.`);
            navigate(`/users/${result.userId}`, { replace: true });
        },
        onError: (error: Error) => toast.error(error.message || `Couldn't unlink ${name}.`),
    });

    return (
        <>
            <Button variant="destructive-soft" size="sm" onClick={() => setOpen(true)}>
                <LinkSlashIcon className="w-4 h-4" aria-hidden="true" />
                Unlink character
            </Button>
            <Modal isOpen={open} onClose={() => { if (!unlink.isPending) setOpen(false); }} title={`Unlink ${name}?`}
                footer={<UnlinkFooter onCancel={() => setOpen(false)} onConfirm={confirm} isPending={unlink.isPending} />}>
                <p className="text-secondary">
                    This deletes <strong className="text-foreground">{name}</strong> and all of its imported LedgerLink
                    data (gear, talents, quests). The in-game character is freed so its rightful owner can re-import it.
                    This can&apos;t be undone.
                </p>
            </Modal>
        </>
    );
}
