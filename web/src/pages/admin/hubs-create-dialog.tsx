/** ROK-1870 — "Create hub": an admin creates an active community hub with a chosen leader. */
import { useState, type JSX } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX, HUB_NAME_MIN } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { useAdminCreateHub } from './use-admin-hubs';
import { MemberCombobox, type MemberOption } from '../../components/shared/member-combobox';
import { GamePicker, type PickedOption } from './hubs-panel-pickers';
import { DialogFooter } from './hubs-panel-dialogs';

/** ROK-2095: the one member picked here is the Leader; everyone else joins from the hub page (ROK-1870 R2). */
const LEADER_HINT = 'Runs the hub. Members join from the hub page once it is live.';

function isComplete(game: PickedOption | null, leader: MemberOption | null, name: string, blurb: string): boolean {
    return !!game && !!leader && name.trim().length >= HUB_NAME_MIN && blurb.trim().length > 0;
}

/** The create-hub form in a Modal. */
export function CreateHubDialog({ onClose }: { onClose: () => void }): JSX.Element {
    const [game, setGame] = useState<PickedOption | null>(null);
    const [leader, setLeader] = useState<MemberOption | null>(null);
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
                <Field label="Game" required>
                    <GamePicker value={game} onChange={setGame} />
                </Field>
                <Field label="Hub name" required>
                    <Input value={name} maxLength={HUB_NAME_MAX} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Blurb" required>
                    <Textarea value={blurb} maxLength={HUB_BLURB_MAX} showCount onChange={(e) => setBlurb(e.target.value)} />
                </Field>
                <Field label="Leader" required hint={LEADER_HINT}>
                    <MemberCombobox value={leader} onChange={setLeader} />
                </Field>
            </div>
        </Modal>
    );
}
