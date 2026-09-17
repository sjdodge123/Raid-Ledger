/**
 * ROK-1573/1572/1571 wireframe constants — shared by the dev components.
 * Kept out of the `.tsx` files so fast refresh stays component-only.
 *
 * Button recipes reuse the shipped scheduling-hero geometry
 * (`scheduling-action-button.ts`) so the LFG hero speaks the poll page's
 * language: 44px phone targets, 36px from `lg`.
 */
import {
    SCHEDULING_ACTION_BUTTON,
    SCHEDULING_ACTION_BUTTON_BASE,
} from '../../components/lineups/cycle-4/scheduling-action-button';

/** The hero's ONE primary action — scheduling-action geometry, emerald fill. */
export const HERO_PRIMARY_BTN =
    `${SCHEDULING_ACTION_BUTTON_BASE} w-full lg:w-auto border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500`;

/** Secondary button in confirms — the shipped neutral scheduling action. */
export const SECONDARY_BTN = SCHEDULING_ACTION_BUTTON;

/** Confirm primary — same fill as the hero primary, intrinsic width. */
export const CONFIRM_PRIMARY_BTN =
    `${SCHEDULING_ACTION_BUTTON_BASE} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500`;

/**
 * The per-time row action. Keeps the shipped overlap-row pill look from `lg`
 * up; a 44px target below it.
 */
export const ROW_ACTION_BTN =
    'shrink-0 inline-flex items-center justify-center rounded-md px-3 text-xs font-semibold ' +
    'min-h-[44px] lg:min-h-[28px] bg-emerald-600 hover:bg-emerald-500 text-white';

/** Proposed copy. */
export const WF_COPY = {
    startSchedulingPoll: 'Start a scheduling poll',
    pollNote: 'Everyone looking gets a Discord card and a vote on times.',
    lockIn: 'Lock in this event',
    openEvent: 'Open the event',
    manage: 'Manage',
    badgeLooking: 'LOOKING FOR MEMBERS',
    badgeFull: 'FULL GROUP',
    badgeEventSet: 'EVENT SET',
} as const;

export type WfVariantId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7';

export const WF_VARIANTS: Array<{ id: WfVariantId; label: string; blurb: string }> = [
    { id: 'H1', label: 'H1 · hero + panels', blurb: 'Top bar: back, copy link, ⋯ (Manage). One hero card: badge, headline + Participants chip; ONE Start a scheduling poll in the row under it. Each shared time carries Lock in this event.' },
    { id: 'H2', label: 'H2 · Manage open', blurb: '⋯ in the top bar open — the group actions (when you want to play, Withdraw). Sheet below 768px, modal from 768px.' },
    { id: 'H3', label: 'H3 · Lock in confirm', blurb: 'Lock in this event on the first time — who gets signed up, and when.' },
    { id: 'H4', label: 'H4 · poll confirm', blurb: 'Start a scheduling poll — who gets the Discord card.' },
    { id: 'H5', label: 'H5 · participants', blurb: 'The Participants chip opened — who is looking, and how soon.' },
    { id: 'H6', label: 'H6 · event set', blurb: 'After Lock in: the hero reads the event; the one primary under it opens it.' },
    { id: 'H7', label: 'H7 · no shared times', blurb: 'Three looking, no shared window: the poll is still the one primary; the overlap panel shows its empty state.' },
];
