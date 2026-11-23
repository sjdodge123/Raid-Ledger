/**
 * Phone confirm before a suggested group's Schedule or Poll acts (operator
 * 2026-11-19: the full-width stacked buttons are easy to mis-tap on a phone).
 * A `BottomSheet` naming the dungeon and its five players, the invite note,
 * then Cancel + Continue. Desktop never mounts it: there the actions act directly.
 */
import type { JSX } from 'react';
import type { SuggestedGroupDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../../../components/ui/bottom-sheet';
import { Button } from '../../../../components/ui/button';
import { inviteCharacterIds, inviteNote } from './suggested-groups-links';

export type SuggestedGroupConfirmKind = 'schedule' | 'poll';

const TITLE: Record<SuggestedGroupConfirmKind, (dungeon: string) => string> = {
    schedule: (dungeon) => `Schedule ${dungeon}?`,
    poll: (dungeon) => `Start a poll for ${dungeon}?`,
};

interface SuggestedGroupConfirmProps {
    kind: SuggestedGroupConfirmKind;
    group: SuggestedGroupDto;
    onConfirm: () => void;
    onClose: () => void;
}

/** Mounted only while asking, so a list of cards never keeps a sheet per card. */
export function SuggestedGroupConfirm({ kind, group, onConfirm, onClose }: SuggestedGroupConfirmProps): JSX.Element {
    const note = inviteNote(inviteCharacterIds(group).length);
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose} data-testid="suggested-group-confirm-cancel">Cancel</Button>
            <Button variant="primary" onClick={onConfirm} data-testid="suggested-group-confirm-continue">Continue</Button>
        </>
    );
    return (
        <BottomSheet isOpen onClose={onClose} title={TITLE[kind](group.instance.name)} footer={footer}>
            <div className="flex flex-col gap-2" data-testid="suggested-group-confirm">
                <ul className="flex flex-col gap-1 text-sm text-foreground" aria-label="Players">
                    {group.members.map((m) => <li key={m.key}>{m.name}</li>)}
                </ul>
                {note !== null && <p className="text-sm text-muted">{note}</p>}
            </div>
        </BottomSheet>
    );
}
