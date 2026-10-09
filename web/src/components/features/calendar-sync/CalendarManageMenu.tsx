/**
 * "Manage" for one calendar connection (ROK-1594, design-system §4.14): a
 * `BottomSheet` of rows below 1024px, a `role="menu"` dropdown from 1024px up.
 * Both shells draw the same `SchedulingSheetRow` actions; Disconnect lives
 * here (plan Q-C). The confirm is owned by this component, not by a shell,
 * so closing the sheet or menu never unmounts it.
 */
import { useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import type { CalendarConnection } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { BottomSheet } from '../../ui/bottom-sheet';
import { SheetTitleRow } from '../../../pages/scheduling/SheetTitleRow';
import { ManageMenuSurface, SchedulingSheetRow } from '../../lineups/cycle-4/scheduling-sheet-row';
import { onMenuKeyDown, useFocusFirstItem } from '../../lineups/cycle-4/scheduling-menu-keys';
import { useMenuOpenState } from '../../lineups/use-menu-open-state';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useDisconnectCalendar } from '../../../hooks/use-calendar-sync';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CalendarDisconnectConfirm } from './CalendarDisconnectConfirm';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

interface ShellProps { onDisconnect: () => void }

function DisconnectRow({ onPick }: { onPick: () => void }): JSX.Element {
    return <SchedulingSheetRow title={C.disconnect} danger onClick={onPick} testId="calendar-disconnect" />;
}

/** ≥1024px: a trigger plus an always-mounted 232px menu (§4.14). */
function ManageDropdown({ onDisconnect }: ShellProps): JSX.Element {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { isOpen, open, close, containerRef } = useMenuOpenState(true, triggerRef);
    useFocusFirstItem(menuRef, isOpen);
    const pick = (): void => { close(); onDisconnect(); };
    return (
        <div className="relative flex-shrink-0" ref={containerRef}>
            <Button ref={triggerRef} variant="secondary" data-testid="calendar-manage" aria-haspopup="menu"
                aria-expanded={isOpen} onClick={() => (isOpen ? close() : open())}>
                {C.manage}
            </Button>
            <div ref={menuRef} role="menu" aria-label={C.manageTitle} hidden={!isOpen} onKeyDown={onMenuKeyDown}
                data-testid="calendar-manage-menu"
                className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1">
                <ManageMenuSurface><DisconnectRow onPick={pick} /></ManageMenuSurface>
            </div>
        </div>
    );
}

/** <1024px: a trigger opening a sheet of 52px rows (§4.14). */
function ManageSheet({ onDisconnect }: ShellProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const pick = (): void => { setOpen(false); onDisconnect(); };
    return (
        <>
            <Button variant="secondary" data-testid="calendar-manage" aria-haspopup="dialog" aria-expanded={open}
                onClick={() => setOpen(true)}>
                {C.manage}
            </Button>
            <BottomSheet isOpen={open} onClose={() => setOpen(false)} ariaLabel={C.manageTitle}>
                <div data-testid="calendar-manage-sheet" className="flex flex-col gap-1 pb-2">
                    <SheetTitleRow title={C.manageTitle} onClose={() => setOpen(false)} />
                    <DisconnectRow onPick={pick} />
                </div>
            </BottomSheet>
        </>
    );
}

export function CalendarManageMenu({ connection }: { connection: CalendarConnection }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [confirming, setConfirming] = useState(false);
    const disconnect = useDisconnectCalendar();
    const ask = (): void => { disconnect.reset(); setConfirming(true); };
    const confirm = (): void => {
        disconnect.mutate(connection.id, {
            onSuccess: () => { setConfirming(false); toast.success(C.toastDisconnected); },
        });
    };
    return (
        <>
            {isDesktop ? <ManageDropdown onDisconnect={ask} /> : <ManageSheet onDisconnect={ask} />}
            <CalendarDisconnectConfirm isOpen={confirming} accountLabel={connection.accountLabel}
                isPending={disconnect.isPending} failed={disconnect.isError}
                onCancel={() => setConfirming(false)} onConfirm={confirm} />
        </>
    );
}
