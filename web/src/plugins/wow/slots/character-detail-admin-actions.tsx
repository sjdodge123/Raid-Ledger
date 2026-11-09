/**
 * WoW plugin filler for the core `character-detail:admin-actions` slot:
 * "Change owner" (ROK-2128) and "Unlink character" (ROK-1756), in the ⋯ menu / More sheet (ROK-2140), for a character
 * linked to an in-game roster row — a LedgerLink GUID (`addonLinked`) or a
 * roster pick (`rosterClaimed`). Core renders the slot for admins only; this
 * self-filters to linked characters, and the API re-checks both (AdminGuard).
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { LinkSlashIcon, UserIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { toast } from '../../../lib/toast';
import { useUnlinkAddonCharacter } from '../hooks/use-unlink-addon-character';
import { CharacterChangeOwner } from './character-change-owner';
import { CharacterAdminOverflow } from './character-admin-overflow';
import type { ActionMenuItem } from '../../../components/ui/action-menu';
import type { CharacterHeaderLayout } from '../../../components/shared/character-header-layout';

interface CharacterDetailAdminActionsProps {
    characterId: string;
    name: string;
    /** Current owner's user id (names them in the Change owner dialog). */
    userId?: number | undefined;
    addonLinked?: boolean | undefined;
    /** ROK-2128: claimed from a guild roster (may have no GUID). */
    rosterClaimed?: boolean | undefined;
    /** ROK-2140: `phone` = More tile + BottomSheet; otherwise the ⋯ menu. */
    layout?: CharacterHeaderLayout | undefined;
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

/** Admin actions for a roster-linked WoW character, behind the header's ⋯ menu / More sheet (ROK-2140); nothing for any other character. */
export function CharacterDetailAdminActions({ characterId, name, userId, addonLinked, rosterClaimed, layout }: CharacterDetailAdminActionsProps) {
    const [unlinkOpen, setUnlinkOpen] = useState(false);
    const [ownerOpen, setOwnerOpen] = useState(false);
    if (addonLinked !== true && rosterClaimed !== true) return null;
    const items: ActionMenuItem[] = [
        { key: 'owner', icon: <UserIcon className="w-4 h-4" aria-hidden="true" />, label: 'Change owner', onClick: () => setOwnerOpen(true) },
        { key: 'unlink', icon: <LinkSlashIcon className="w-4 h-4" aria-hidden="true" />, label: 'Unlink character', destructive: true, onClick: () => setUnlinkOpen(true) },
    ];
    return (
        <>
            <CharacterAdminOverflow name={name} items={items} layout={layout ?? 'desktop'} />
            <CharacterChangeOwner characterId={characterId} name={name} ownerId={userId} open={ownerOpen} onOpenChange={setOwnerOpen} onUnlink={() => setUnlinkOpen(true)} />
            <UnlinkConfirm characterId={characterId} name={name} open={unlinkOpen} setOpen={setUnlinkOpen} />
        </>
    );
}
