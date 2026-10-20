/** ROK-1870 — "Create hub": an admin creates an active community hub with a chosen leader. */
import { useState, type JSX } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX, HUB_NAME_MIN } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { useAdminCreateHub } from './use-admin-hubs';
import { GamePicker, UserPicker, type PickedOption } from './hubs-panel-pickers';
import { DialogFooter } from './hubs-panel-dialogs';

function isComplete(game: PickedOption | null, leader: PickedOption | null, name: string, blurb: string): boolean {
    return !!game && !!leader && name.trim().length >= HUB_NAME_MIN && blurb.trim().length > 0;
}

/** The create-hub form in a Modal. */
export function CreateHubDialog({ onClose }: { onClose: () => void }): JSX.Element {
    const [game, setGame] = useState<PickedOption | null>(null);
    const [leader, setLeader] = useState<PickedOption | null>(null);
    const [name, setName] = useState('');
    const [blurb, setBlurb] = useState('');
    const create = useAdminCreateHub();
    const submit = (): void => {
        if (!game || !leader) return;
        create.mutate({ gameId: game.id, leaderUserId: leader.id, name: name.trim(), blurb: blurb.trim() }, { onSuccess: onClose });
    };
    const footer = (
        <DialogFooter error={create.error?.message ?? null} onCancel={onClose}>
            <Button variant="primary" disabled={!isComplete(game, leader, name, blurb)} loading={create.isPending} onClick={submit}>Create</Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title="Create hub" footer={footer}>
            <div className="space-y-4">
                <GamePicker label="Game" value={game} onChange={setGame} />
                <Field label="Hub name" required>
                    <Input value={name} maxLength={HUB_NAME_MAX} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Blurb" required>
                    <Textarea value={blurb} maxLength={HUB_BLURB_MAX} showCount onChange={(e) => setBlurb(e.target.value)} />
                </Field>
                <UserPicker label="Leader" value={leader} onChange={setLeader} />
            </div>
        </Modal>
    );
}
