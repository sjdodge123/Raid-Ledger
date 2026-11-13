/**
 * ROK-1789 — the recruitment editor dialog. PLACEHOLDER from L4 (web read):
 * L5 replaces this body with the Modal / BottomSheet editor (spec "Web" table).
 * The card mounts it lazily while `useRecruitmentDialog` names this hub, so
 * the contract below (default export, these props) must stay.
 */
import type { JSX } from 'react';

export interface RecruitmentDialogProps {
    guildId: number;
    /** Closes the editor (clears `useRecruitmentDialog`). */
    onClose: () => void;
}

/** L5 fills this in; until then the open store state renders nothing. */
export default function RecruitmentDialog(props: RecruitmentDialogProps): JSX.Element | null {
    void props;
    return null;
}
