/**
 * ROK-1875 (operator ruling 2026-10-21) — the raised centre "Hubs" circle of
 * the phone bottom bar. A hub member taps it for the "Your hubs" sheet; no
 * hubs, or the list still loading / failed → a plain link to `/hubs` (the
 * `HubsNavItem` D1 rule). It reads the same `useMyGuildsQuery` cache as the
 * header menu and the More drawer — no second fetch. Active on `/hubs` and on
 * every hub page (`isHubsNavActive`).
 *
 * Layout: the slot fills its grid column; the 56px circle sits absolutely,
 * raised 24px above the bar's top edge and centred, so it never widens the
 * column and never covers a neighbour. The label sits at the bar's bottom.
 */
import { lazy, Suspense, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Squares2X2Icon } from '@heroicons/react/24/solid';
import type { MyGuild } from '@raid-ledger/contract';
import { HUBS_PATH, useMyGuildsQuery } from './my-hubs-queries';
import { isHubsNavActive } from './use-hub-nav-active';

const BottomHubsSheet = lazy(() => import('./bottom-hubs-sheet'));

/** The slot: fills its column, label pinned to the bar's bottom, ≥56px tall. */
const SLOT_CLASS = 'relative flex h-14 w-full flex-col items-center justify-end pb-1.5 focus-visible:outline-none group';
/** The raised circle: `bg-success` + `text-white` (painted `--color-status-solid-label` on both families). */
const CIRCLE_CLASS = 'absolute -top-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full '
    + 'border-4 border-surface bg-success text-white shadow-lg transition-transform duration-75 group-active:scale-95 '
    + 'group-focus-visible:ring-2 group-focus-visible:ring-success/50';
const ACTIVE_RING = 'ring-2 ring-success/40 ring-offset-0';

function SlotFace({ active }: { active: boolean }): JSX.Element {
    return (
        <>
            <span data-testid="bottom-hubs-circle" aria-hidden="true" className={`${CIRCLE_CLASS} ${active ? ACTIVE_RING : ''}`}>
                <Squares2X2Icon className="h-6 w-6" />
            </span>
            <span className={`text-[10px] font-medium ${active ? 'text-emerald-400' : 'text-secondary'}`}>Hubs</span>
        </>
    );
}

function SheetSlot({ active, hubs }: { active: boolean; hubs: MyGuild[] }): JSX.Element {
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const close = (): void => setOpen(false);
    return (
        <>
            <button type="button" aria-label="Hubs" aria-haspopup="dialog" aria-expanded={open} aria-current={active ? 'page' : undefined}
                data-testid="bottom-hubs-trigger" className={SLOT_CLASS} onClick={() => { setLoaded(true); setOpen(true); }}>
                <SlotFace active={active} />
            </button>
            {loaded && <Suspense fallback={null}><BottomHubsSheet isOpen={open} onClose={close} hubs={hubs} /></Suspense>}
        </>
    );
}

/** The centre Hubs slot of the phone bottom bar. */
export function BottomHubsButton({ pathname }: { pathname: string }): JSX.Element {
    const hubs = useMyGuildsQuery().data?.guilds ?? [];
    const active = isHubsNavActive(pathname);
    if (hubs.length > 0) {
        return <SheetSlot active={active} hubs={hubs} />;
    }
    return (
        <Link to={HUBS_PATH} aria-label="Hubs" aria-current={active ? 'page' : undefined} data-testid="bottom-hubs-link" className={SLOT_CLASS}>
            <SlotFace active={active} />
        </Link>
    );
}
