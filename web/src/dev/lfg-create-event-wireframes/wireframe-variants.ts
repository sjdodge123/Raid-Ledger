/**
 * ROK-1573/1572 wireframe constants — shared by the dev variant components.
 * Kept out of the `.tsx` files so fast refresh stays component-only.
 */

/** Same classes as the shipped `LfgStatusBar`. */
export const PRIMARY_BTN =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50';
export const SECONDARY_BTN =
    'px-3 py-1.5 rounded-md text-sm font-semibold bg-overlay hover:bg-faint text-foreground disabled:opacity-50';

/** Proposed copy. */
export const WF_COPY = {
    createEvent: 'Create event',
    startSchedulingPoll: 'Start a scheduling poll',
    actionsNote: 'Everyone looking gets a Discord card and a vote on times.',
} as const;

/** side = L1a, stacked = L1b, poll-first = L2. */
export type WfActionsLayout = 'side' | 'stacked' | 'poll-first';

export type WfVariantId = 'L1a' | 'L1b' | 'L2' | 'L3' | 'L4' | 'L5';

export const WF_VARIANTS: Array<{ id: WfVariantId; label: string; blurb: string }> = [
    { id: 'L1a', label: 'L1a · side by side', blurb: 'Shared time exists: Create event (primary) and Start a scheduling poll (secondary) side by side.' },
    { id: 'L1b', label: 'L1b · stacked', blurb: 'Same, stacked full-width; the primary names the best time.' },
    { id: 'L2', label: 'L2 · no shared time', blurb: 'No overlap: the poll becomes primary, Create event secondary.' },
    { id: 'L3', label: 'L3 · poll confirm', blurb: 'L1a with the confirm open — BottomSheet below 768px, Modal from 768px.' },
    { id: 'L4', label: 'L4 · event created', blurb: 'After Create event: the bar gains the event row; join/withdraw stays.' },
    { id: 'L5', label: 'L5 · create form', blurb: '/events/new arriving from the group: the page header plus the context note.' },
];
