/**
 * ROK-1950 — Admin → Hubs "Rename": staff rename an active community hub
 * through the same `PATCH /guilds/:id/name` the hub's settings sheet uses.
 * The server error shows inline; the dialog closes only on success.
 */
import { useState, type JSX } from 'react';
import { HUB_NAME_MAX, HUB_NAME_MIN } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { DialogFooter } from './hubs-panel-dialogs';
import { useRenameHub, type AdminHubEntry } from './use-admin-hubs';

/** Rename `hub`; Save stays disabled until the trimmed name changes and meets the minimum. */
export function RenameHubDialog({ hub, onClose }: { hub: AdminHubEntry; onClose: () => void }): JSX.Element {
    const [name, setName] = useState(hub.name);
    const rename = useRenameHub();
    const next = name.trim();
    const valid = next !== hub.name && next.length >= HUB_NAME_MIN;
    const submit = (): void => rename.mutate({ hubId: hub.id, name: next }, { onSuccess: onClose });
    const footer = (
        <DialogFooter error={rename.error?.message ?? null} onCancel={onClose}>
            <Button variant="primary" disabled={!valid} loading={rename.isPending} onClick={submit}>Save name</Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title={`Rename “${hub.name}”`} footer={footer}>
            <Field label="Hub name" required hint="Shown on the hub, in the directory and on Discord.">
                <Input value={name} maxLength={HUB_NAME_MAX} onChange={(e) => setName(e.target.value)} data-testid="admin-hub-rename-input" />
            </Field>
        </Modal>
    );
}
