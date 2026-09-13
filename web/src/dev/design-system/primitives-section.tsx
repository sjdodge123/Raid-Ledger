/**
 * Primitive inventory for /dev/design-system (ROK-1539) — the flat pieces:
 * badges, chips, buttons, inputs, empty and loading states. Overlays and
 * containers live in `overlays-section.tsx` so both files stay small.
 *
 * Every example mounts the REAL component from `web/src/components/ui` (or
 * reproduces the exact class string where the real one is position-fixed).
 * If an example here stops matching production, production changed and this
 * page is the early warning.
 */
import type { JSX } from 'react';
import { LoadingSpinner } from '../../components/ui/loading-spinner';
import { NewBadge } from '../../components/ui/new-badge';
import { RoleBadge } from '../../components/ui/role-badge';
import { ModalSearchInput, ModalEmptyState } from '../../components/ui/modal-helpers';
import { LineupEmptyState } from '../../components/lineups/LineupEmptyState';
import { Section, StateFrame, StateGrid } from './design-system-bits';

/** Chip geometry, verbatim from pages/games/library-filter-chips.tsx. */
const CHIP_BASE = 'inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors';
const CHIP_ON = 'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20';
const CHIP_OFF = 'bg-panel border border-edge text-secondary hover:bg-overlay';

function BadgeStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Badges — default">
                <RoleBadge role="admin" />
                <RoleBadge role="operator" />
                <NewBadge visible />
            </StateFrame>
            <StateFrame label="Badges — empty" note="RoleBadge renders nothing for member; NewBadge nothing when visible={false}.">
                <RoleBadge role="member" />
                <NewBadge visible={false} />
                <span className="text-xs text-dim">(both render null)</span>
            </StateFrame>
            <StateFrame label="Count badge" note="filter-panel.tsx::FilterBadge — never rendered at zero.">
                <span className="relative inline-flex px-3 py-2 text-sm text-muted border border-edge rounded-lg">
                    Trigger
                    <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-emerald-500 rounded-full">7</span>
                </span>
            </StateFrame>
        </>
    );
}

function ChipStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Filter chip — off / on" note="aria-pressed on a <button type='button'>; 44px target.">
                <button type="button" aria-pressed={false} className={`${CHIP_BASE} ${CHIP_OFF}`}>4 players</button>
                <button type="button" aria-pressed className={`${CHIP_BASE} ${CHIP_ON}`}>3 players</button>
            </StateFrame>
            <StateFrame label="Filter chip — disabled">
                <button type="button" disabled className={`${CHIP_BASE} ${CHIP_OFF} opacity-50 cursor-not-allowed`}>2 own</button>
            </StateFrame>
            <StateFrame label="Filter chip — hover" note="Hover the live chips above; hover is a token swap, not a shadow.">
                <span className={`${CHIP_BASE} bg-overlay border border-edge text-secondary`}>hover fill = bg-overlay</span>
            </StateFrame>
        </>
    );
}

const BTN_PRIMARY = 'px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors';
const BTN_SECONDARY = 'px-3 py-2 rounded-lg text-sm font-medium bg-panel border border-edge text-secondary hover:bg-overlay transition-colors';
const BTN_DANGER = 'px-3 py-2 rounded-lg text-sm font-medium bg-red-600/20 border border-red-500/40 text-red-300 hover:bg-red-600/30 transition-colors';

function ButtonStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Buttons — default" note="Global CSS scales :active to 0.97; do not add your own press state.">
                <button type="button" className={BTN_PRIMARY}>Primary</button>
                <button type="button" className={BTN_SECONDARY}>Secondary</button>
                <button type="button" className={BTN_DANGER}>Destructive</button>
            </StateFrame>
            <StateFrame label="Buttons — disabled">
                <button type="button" disabled className={`${BTN_PRIMARY} disabled:opacity-50`}>Primary</button>
                <button type="button" disabled className={`${BTN_SECONDARY} disabled:opacity-50`}>Secondary</button>
            </StateFrame>
            <StateFrame label="Buttons — loading" note="Keep the label; swap the icon. Never collapse the button's width.">
                <button type="button" disabled className={`${BTN_PRIMARY} disabled:opacity-70 inline-flex items-center gap-2`}>
                    <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Saving…
                </button>
            </StateFrame>
        </>
    );
}

const INPUT_CLS = 'min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground placeholder:text-dim w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

function InputStates(): JSX.Element {
    return (
        <>
            <StateFrame label="Text input — default / disabled" note="text-base is deliberate: 16px stops iOS Safari zooming on focus.">
                <input className={INPUT_CLS} placeholder="Search games…" readOnly />
                <input className={`${INPUT_CLS} opacity-50`} placeholder="Disabled" disabled />
            </StateFrame>
            <StateFrame label="Slider + checkbox" note="Numeric readout is font-mono; label is font-medium; 44px row.">
                <label className="flex items-center gap-3 text-base text-foreground min-h-[44px] w-full">
                    <span className="whitespace-nowrap font-medium">Min owners</span>
                    <input type="range" min={0} max={15} defaultValue={4} className="flex-1 h-11 accent-emerald-500" />
                    <span className="text-sm font-mono w-6 text-right text-foreground">4</span>
                </label>
                <label className="flex items-center gap-2 text-base text-foreground min-h-[44px]">
                    <input type="checkbox" defaultChecked className="w-5 h-5 accent-emerald-500" />
                    <span className="font-medium">Co-op for our group size</span>
                </label>
            </StateFrame>
            <StateFrame label="ModalSearchInput" note="Third search-input geometry in the codebase — see docs/design-system.md §6.4.">
                <ModalSearchInput value="" onChange={() => undefined} />
            </StateFrame>
        </>
    );
}

function EmptyAndLoading(): JSX.Element {
    return (
        <>
            <StateFrame label="Empty — page/section">
                <div className="w-full"><LineupEmptyState /></div>
            </StateFrame>
            <StateFrame label="Empty — inside a modal">
                <div className="w-full"><ModalEmptyState /></div>
            </StateFrame>
            <StateFrame label="Loading — route Suspense fallback">
                <div className="w-full"><LoadingSpinner /></div>
            </StateFrame>
        </>
    );
}

/** Flat primitives in default / hover / disabled / loading / empty states. */
export function PrimitivesSection(): JSX.Element {
    return (
        <Section
            id="primitives"
            title="Primitives — badges, chips, buttons, inputs, states"
            blurb="The flat pieces, each in the states it actually ships in. Mock data only; nothing here calls the API."
        >
            <StateGrid>
                <BadgeStates />
                <ChipStates />
                <ButtonStates />
                <InputStates />
                <EmptyAndLoading />
            </StateGrid>
        </Section>
    );
}
