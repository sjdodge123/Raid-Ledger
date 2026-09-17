/**
 * ROK-1573/1572/1571 — the LFG group page's button recipes, ported from the
 * approved wireframe (`dev/lfg-create-event-wireframes/wireframe-variants.ts`).
 *
 * Built on the shipped scheduling-hero geometry (`scheduling-action-button.ts`)
 * so the LFG hero speaks the poll page's language: 44px phone targets, 36px
 * from `lg`. Neutrals are tokens; the emerald fill carries white ink, which
 * reads the same on every scheme.
 */
import {
    SCHEDULING_ACTION_BUTTON,
    SCHEDULING_ACTION_BUTTON_BASE,
} from '../../components/lineups/cycle-4/scheduling-action-button';

/** Emerald fill shared by every LFG primary. */
const EMERALD_FILL =
    'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500';

/** The hero's ONE primary action — full width on phones, intrinsic from `lg`. */
export const LFG_HERO_PRIMARY_BTN = `${SCHEDULING_ACTION_BUTTON_BASE} w-full lg:w-auto ${EMERALD_FILL}`;

/** Secondary button in confirms — the shipped neutral scheduling action. */
export const LFG_SECONDARY_BTN = SCHEDULING_ACTION_BUTTON;

/** Confirm primary — same fill as the hero primary, intrinsic width. */
export const LFG_CONFIRM_PRIMARY_BTN = `${SCHEDULING_ACTION_BUTTON_BASE} ${EMERALD_FILL}`;

/**
 * The per-time overlap row action ("Lock in this event"). Keeps the shipped
 * overlap-row pill look from `lg` up; a 44px target below it.
 */
export const LFG_ROW_ACTION_BTN =
    'shrink-0 inline-flex items-center justify-center rounded-md px-3 text-xs font-semibold ' +
    'min-h-[44px] lg:min-h-[28px] bg-emerald-600 hover:bg-emerald-500 text-white ' +
    'disabled:opacity-50';

/** Top-bar icon button — 44px on phones, the lineup header's 32px from `lg`. */
export const LFG_ICON_BTN =
    'inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-[32px] lg:min-w-[32px] ' +
    'px-2.5 py-1.5 text-xs text-muted hover:text-foreground rounded border border-edge/50 hover:bg-overlay/50 ' +
    'transition-colors flex-shrink-0';
