/**
 * ROK-1870 — Approve / Reject / Transfer-leader dialogs for Admin → Hubs.
 * Server errors render inline; the dialog closes only on success.
 */
import { useState, type JSX } from 'react';
import { HUB_BLURB_MAX, HUB_NAME_MAX, HUB_NAME_MIN, HUB_REJECT_REASON_MAX, type HubProposal } from '@raid-ledger/contract';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { useApproveHubProposal, useRejectHubProposal, useTransferHubLeader, type AdminHubEntry } from './use-admin-hubs';
import { UserPicker, type PickedOption } from './hubs-panel-pickers';

/** Footer: the server error (if any), Cancel and the primary action. */
export function DialogFooter({ error, onCancel, children }: { error: string | null; onCancel: () => void; children: JSX.Element }): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                {children}
            </div>
        </div>
    );
}

interface ProposalDialogProps {
    proposal: HubProposal;
    onClose: () => void;
}

/** Approve, letting the admin tidy the name and blurb first. */
export function ApproveHubDialog({ proposal, onClose }: ProposalDialogProps): JSX.Element {
    const [name, setName] = useState(proposal.name);
    const [blurb, setBlurb] = useState(proposal.blurb);
    const approve = useApproveHubProposal();
    const valid = name.trim().length >= HUB_NAME_MIN && blurb.trim().length > 0;
    const submit = (): void => approve.mutate({ id: proposal.id, body: { name: name.trim(), blurb: blurb.trim() } }, { onSuccess: onClose });
    const footer = (
        <DialogFooter error={approve.error?.message ?? null} onCancel={onClose}>
            <Button variant="primary" disabled={!valid} loading={approve.isPending} onClick={submit}>Approve hub</Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title={`Approve “${proposal.name}”`} footer={footer}>
            <div className="space-y-4">
                <p className="text-sm text-secondary">{proposal.proposedBy.username} becomes the hub's Leader.</p>
                <Field label="Hub name" required>
                    <Input value={name} maxLength={HUB_NAME_MAX} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Blurb" required>
                    <Textarea value={blurb} maxLength={HUB_BLURB_MAX} showCount onChange={(e) => setBlurb(e.target.value)} />
                </Field>
            </div>
        </Modal>
    );
}

/** Reject with a reason the proposer sees; submit stays disabled until one is typed. */
export function RejectHubDialog({ proposal, onClose }: ProposalDialogProps): JSX.Element {
    const [reason, setReason] = useState('');
    const reject = useRejectHubProposal();
    const submit = (): void => reject.mutate({ id: proposal.id, reason: reason.trim() }, { onSuccess: onClose });
    const footer = (
        <DialogFooter error={reject.error?.message ?? null} onCancel={onClose}>
            <Button variant="destructive" disabled={reason.trim().length === 0} loading={reject.isPending} onClick={submit}>
                Reject proposal
            </Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title={`Reject “${proposal.name}”`} footer={footer}>
            <Field label="Reason" required hint={`${proposal.proposedBy.username} sees this reason.`}>
                <Textarea value={reason} maxLength={HUB_REJECT_REASON_MAX} showCount onChange={(e) => setReason(e.target.value)} />
            </Field>
        </Modal>
    );
}

/** Hand the hub to another member; the server refuses a non-member (404) or the current leader (409). */
export function TransferLeaderDialog({ hub, onClose }: { hub: AdminHubEntry; onClose: () => void }): JSX.Element {
    const [target, setTarget] = useState<PickedOption | null>(null);
    const transfer = useTransferHubLeader();
    const submit = (): void => {
        if (target) transfer.mutate({ hubId: hub.id, userId: target.id }, { onSuccess: onClose });
    };
    const footer = (
        <DialogFooter error={transfer.error?.message ?? null} onCancel={onClose}>
            <Button variant="primary" disabled={!target} loading={transfer.isPending} onClick={submit}>Transfer</Button>
        </DialogFooter>
    );
    return (
        <Modal isOpen onClose={onClose} title={`Transfer leadership of “${hub.name}”`} footer={footer}>
            <UserPicker label="New leader" value={target} onChange={setTarget} />
        </Modal>
    );
}
