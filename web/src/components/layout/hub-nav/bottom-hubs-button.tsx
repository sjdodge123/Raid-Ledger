/**
 * ROK-1875 (operator ruling 2026-10-21) — the raised centre "Hubs" circle of
 * the phone bottom bar. A hub member taps it for the "Your hubs" sheet; no
 * hubs, or the list still loading / failed → a plain link to `/hubs` (the
 * `HubsNavItem` D1 rule). ROK-2152 Q1: no hubs but a popular hub to suggest →
 * the sheet too (`useHubsNavLists`, the same rule as the header). It reads
 * the same `useMyGuildsQuery` and popular caches as the header menu — no
 * second fetch. Active on `/hubs` and on every hub page (`isHubsNavActive`).
 *
 * Layout: the slot fills its grid column; the 56px circle sits absolutely,
 * raised 24px above the bar's top edge and centred, so it never widens the
 * column and never covers a neighbour. The label sits at the bar's bottom.
 */
import { lazy, Suspense, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { HubDirectoryEntry, MyGuild } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { HubsCircle } from './hubs-circle';
import { HUBS_PATH } from './my-hubs-queries';
import { useHubsNavLists } from './popular-hubs-queries';
import { isHubsNavActive } from './use-hub-nav-active';

const BottomHubsSheet = lazy(() => import('./bottom-hubs-sheet'));

/** The slot: fills its column and the bar's 56px height; circle and label are positioned inside it. */
const SLOT_CLASS = 'relative h-14 w-full group';
/** The link variant adds the layout `Button variant="bare"` already brings. */
const LINK_SLOT_CLASS = `${SLOT_CLASS} flex items-center justify-center focus-visible:outline-none`;

function SlotFace({ active }: { active: boolean }): JSX.Element {
    return (
        <>
            <HubsCircle size="raised" active={active} testId="bottom-hubs-circle" />
            <span className={`absolute inset-x-0 bottom-1.5 text-center text-[10px] font-medium ${active ? 'text-success' : 'text-secondary'}`}>Hubs</span>
        </>
    );
}

interface SlotProps { active: boolean; hubs: MyGuild[]; popular: HubDirectoryEntry[] }

function SheetSlot({ active, hubs, popular }: SlotProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const close = (): void => setOpen(false);
    return (
        <>
            <Button variant="bare" aria-label="Hubs" aria-haspopup="dialog" aria-expanded={open} aria-current={active ? 'page' : undefined}
                data-testid="bottom-hubs-trigger" className={SLOT_CLASS} onClick={() => { setLoaded(true); setOpen(true); }}>
                <SlotFace active={active} />
            </Button>
            {loaded && <Suspense fallback={null}><BottomHubsSheet isOpen={open} onClose={close} hubs={hubs} popular={popular} /></Suspense>}
        </>
    );
}

/** The centre Hubs slot of the phone bottom bar. */
export function BottomHubsButton({ pathname }: { pathname: string }): JSX.Element {
    const { hubs, popular, showMenu } = useHubsNavLists();
    const active = isHubsNavActive(pathname);
    if (showMenu) return <SheetSlot active={active} hubs={hubs} popular={popular} />;
    return (
        <Link to={HUBS_PATH} aria-label="Hubs" aria-current={active ? 'page' : undefined} data-testid="bottom-hubs-link" className={LINK_SLOT_CLASS}>
            <SlotFace active={active} />
        </Link>
    );
}
