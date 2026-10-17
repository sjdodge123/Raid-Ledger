/**
 * ROK-1573/1572/1571 — class recipes and copy for the LFG group dialogs
 * (Manage, Lock-in confirm, poll confirm, participants). Ported from the
 * approved wireframe (`wireframe-variants.ts`, `WfOverlays.tsx`,
 * `WfParticipants.tsx`). Kept out of the `.tsx` files so fast refresh stays
 * component-only. Tokens only; 44px targets below `lg`.
 */
import { SCHEDULING_ACTION_BUTTON } from '../../components/lineups/cycle-4/scheduling-action-button';
import { LFG_CONFIRM_PRIMARY_BTN } from './lfg-action-buttons';

/** Secondary button in confirms — the shipped neutral scheduling action. */
export const LFG_DIALOG_SECONDARY_BTN = SCHEDULING_ACTION_BUTTON;

/**
 * Confirm primary — the shared LFG confirm recipe (emerald fill only; the
 * scheduling base's `bg-surface` blanked it in light themes).
 */
export const LFG_DIALOG_PRIMARY_BTN =
    `${LFG_CONFIRM_PRIMARY_BTN} disabled:cursor-not-allowed disabled:opacity-60`;

/**
 * The Participants chip — `LineupParticipantsButton`'s `touch` size (file-private
 * there): a 44px target below `lg`, the 36px desktop chip from `lg`.
 */
export const LFG_PARTICIPANTS_CHIP_CLS =
    'inline-flex items-center gap-2 rounded-full border transition-colors ' +
    'min-h-[44px] px-3 py-2 text-sm border-edge-strong bg-surface text-foreground ' +
    'hover:text-foreground lg:hover:border-edge-strong/80 ' +
    'lg:min-h-[36px] lg:px-3 lg:py-0 lg:text-xs lg:border-edge-strong lg:bg-surface lg:text-foreground';

/** Dialog strings (W2 may fold these into `LFG_COPY`). */
export const LFG_DIALOG_COPY = {
    cancel: 'Cancel',
    manageTitle: 'Manage',
    withdrawNote: 'Leave the group',
    urgencyNowLabel: 'Right now',
    pickAgain: 'Pick again to change it.',
    lockInTitle: 'Lock in this event?',
    lockInSubmit: 'Lock in',
    notFreeThen: 'not free then',
    pollTitle: 'Start a scheduling poll?',
    pollSubmit: 'Start poll',
    startNowTitle: 'Start playing right now?',
    startNowSubmit: 'Start now',
    participants: 'Participants',
} as const;

/** ` · all 3 in the group get signed up and a Discord card.` — the whole group, per the operator ruling. */
export const lockInBody = (count: number): string =>
    ` · all ${count} in the group get signed up and a Discord card.`;

/** `These 3 people get a Discord card and a vote on times. You land on the poll next.` */
export const pollBody = (count: number): string =>
    `These ${count} people get a Discord card and a vote on times. You land on the poll next.`;

/** `Participants · 3` */
export const participantsLabel = (count: number): string =>
    `${LFG_DIALOG_COPY.participants} · ${count}`;

/**
 * ROK-1613 AC4 — the start-now confirm's body. The starter is IN; everyone
 * else is ASKED, so the sentence must never read as signing them up. A group
 * of one gets its own line rather than "the other 0".
 *
 * @param inviteeCount - Live members other than the starter.
 */
export const startNowBody = (inviteeCount: number): string =>
    inviteeCount === 0
        ? 'You start right now. Nobody else is in the group yet.'
        : `You start right now. The other ${inviteeCount} get an invite and a Discord card — they are asked, not signed up.`;
