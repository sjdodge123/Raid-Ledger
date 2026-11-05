/**
 * ROK-1870 — "Create hub": an admin creates an active community hub with a
 * chosen leader. ROK-2095: labelled pickers + the shared avatar member picker.
 * ROK-2096 (operator ruling 2026-11-05): the admin may also add the first
 * members, with the shared `InviteeMultiSelect`.
 */
import { useState, type JSX } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX, HUB_NAME_MIN, type AdminCreateHubDto } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { MemberCombobox, type MemberOption } from '../../components/shared/member-combobox';
import { InviteeMultiSelect } from '../../components/lineups/InviteeMultiSelect';
import { useAdminCreateHub } from './use-admin-hubs';
import { GamePicker, type PickedOption } from './hubs-panel-pickers';
import { DialogFooter } from './hubs-panel-dialogs';
import { initialMembers, membersLimitError } from './hubs-create-form';

const LEADER_HINT = 'Runs the hub. Anyone else can still join from the hub page once it is live.';
const MEMBERS_COPY = {
    label: 'Members (optional)',
    hint: 'Optional — add the people who should start in the hub.',
    noun: 'member',
};

function useCreateHubForm() {
    const [game, setGame] = useState<PickedOption | null>(null);
    const [leader, setLeader] = useState<MemberOption | null>(null);
    const [name, setName] = useState('');
    const [blurb, setBlurb] = useState('');
    const [members, setMembers] = useState<number[]>([]);
    const memberUserIds = initialMembers(members, leader?.id ?? null);
    const membersError = membersLimitError(memberUserIds.length);
    const complete = !!game && !!leader && name.trim().length >= HUB_NAME_MIN && blurb.trim().length > 0 && membersError === null;
    const body = (): AdminCreateHubDto | null => {
        if (!game || !leader) return null;
        return {
            gameId: game.id, leaderUserId: leader.id, name: name.trim(), blurb: blurb.trim(),
            ...(memberUserIds.length > 0 ? { memberUserIds } : {}),
        };
    };
    return { game, setGame, leader, setLeader, name, setName, blurb, setBlurb, members, setMembers, membersError, complete, body };
}

type CreateHubForm = ReturnType<typeof useCreateHubForm>;

function CreateHubFields({ f }: { f: CreateHubForm }): JSX.Element {
    return (
        <div className="space-y-4">
            <Field label="Game" required>
                <GamePicker value={f.game} onChange={f.setGame} />
            </Field>
            <Field label="Hub name" required>
                <Input value={f.name} maxLength={HUB_NAME_MAX} onChange={(e) => f.setName(e.target.value)} />
            </Field>
            <Field label="Blurb" required>
                <Textarea value={f.blurb} maxLength={HUB_BLURB_MAX} showCount onChange={(e) => f.setBlurb(e.target.value)} />
            </Field>
            <Field label="Leader" required hint={LEADER_HINT}>
                <MemberCombobox value={f.leader} onChange={f.setLeader} />
            </Field>
            <InviteeMultiSelect value={f.members} onChange={f.setMembers} copy={MEMBERS_COPY} hideBadges
                {...(f.leader ? { excludeIds: [f.leader.id] } : {})} />
            {f.membersError && <p role="alert" className="text-sm text-danger">{f.membersError}</p>}
        </div>
    );
}

/** The create-hub form in a Modal. */
export function CreateHubDialog({ onClose }: { onClose: () => void }): JSX.Element {
    const f = useCreateHubForm();
    const create = useAdminCreateHub();
    const submit = (): void => {
        const body = f.body();
        if (body) create.mutate(body, { onSuccess: onClose });
    };
    const footer = (
        <DialogFooter error={create.error?.message ?? null} onCancel={onClose}>
            <Button variant="primary" disabled={!f.complete} loading={create.isPending} onClick={submit}>Create</Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title="Create hub" footer={footer}>
            <CreateHubFields f={f} />
        </Modal>
    );
}
