/**
 * ROK-1899 — the detail pane below `DESKTOP_MQ` (spec §3.3, OQ6): a
 * `BottomSheet` titled with the item, the meta + slots + collapsed breakdown
 * in the body and Upgrade-to / Amount / "Add to list" in the sticky footer.
 * A successful add closes the sheet; Escape or close hands focus back to the
 * row (the sheet's own focus return).
 */
import type { JSX } from 'react';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { CraftDetailBody, type CraftDetailProps } from './craft-detail';
import { detailTitle, useDetailQuality } from './craft-detail.helpers';
import { CraftDetailFooter } from './craft-detail-footer';
import type { PlannerTarget } from './planner.helpers';

export interface CraftDetailSheetProps extends CraftDetailProps {
    isOpen: boolean;
    onClose: () => void;
}

/** The phone detail sheet. */
export function CraftDetailSheet({ isOpen, onClose, ...detail }: CraftDetailSheetProps): JSX.Element {
    const [quality, setQuality] = useDetailQuality(detail.row, detail.mode);
    const onAdd = (target: PlannerTarget): boolean => {
        const added = detail.onAdd(target);
        if (added) onClose();
        return added;
    };
    const footer = (
        <CraftDetailFooter mode={detail.mode} entry={detail.row.entry} quality={quality} onQuality={setQuality} onAdd={onAdd} atCap={detail.atCap} />
    );
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title={detailTitle(detail.row, detail.mode, quality)} footer={footer}>
            <CraftDetailBody {...detail} quality={quality} showTitle={false} breakdownOpen={false} />
        </BottomSheet>
    );
}
