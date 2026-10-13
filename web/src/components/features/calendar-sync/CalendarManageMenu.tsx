/**
 * "Manage" for one calendar connection (ROK-1594, design-system §4.14): a
 * `BottomSheet` of rows below 1024px, a `role="menu"` dropdown from 1024px up.
 * Both shells draw the same `SchedulingSheetRow` actions: "Sync now" while
 * reading is on (ROK-1595, ruling F-4; a 429 answers "Synced a moment ago"),
 * then Disconnect (plan Q-C). The phone sheet also opens "Calendars to
 * check" in place (desktop shows that picker inline in the card). The confirm
 * is owned by this component, not by a shell, so closing the sheet or menu
 * never unmounts it.
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
import { useSyncNow } from '../../../hooks/use-calendar-read';
import { calendarReadErrorOf } from '../../../hooks/calendar-read.helpers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CalendarDisconnectConfirm } from './CalendarDisconnectConfirm';
import { CalendarPicker } from './CalendarPicker';
import { readGranted } from './use-read-rules';
import { CALENDARS_COPY as C, READ_COPY as R } from './calendar-sync.copy';

/** `onSync` is absent when reading is off, not granted, or the connection is broken. */
interface ShellProps { connection: CalendarConnection; onDisconnect: () => void; onSync: (() => void) | null }

function DisconnectRow({ onPick }: { onPick: () => void }): JSX.Element {
    return <SchedulingSheetRow title={C.disconnect} danger onClick={onPick} testId="calendar-disconnect" />;
}

function SyncRow({ onPick }: { onPick: () => void }): JSX.Element {
    return <SchedulingSheetRow title={R.syncNow} onClick={onPick} testId="calendar-sync-now" />;
}

/** "Sync now": 202 → "Syncing your calendar…", 429 → "Synced a moment ago…" (no retry loop). */
function useSyncNowAction(connection: CalendarConnection): (() => void) | null {
    const sync = useSyncNow();
    const canSync = connection.status === 'active' && connection.read.enabled && readGranted(connection);
    if (!canSync) return null;
    return () => sync.mutate(connection.id, {
        onSuccess: (r) => (r.outcome === 'queued' ? toast.success(R.syncing) : toast.info(R.throttled)),
        onError: (e) => {
            const kind = calendarReadErrorOf(e);
            toast.error(kind === 'read_scopes' || kind === 'read_disabled' ? R.syncNeedsRead : R.syncFailed);
        },
    });
}

/** ≥1024px: a trigger plus an always-mounted 232px menu (§4.14). */
function ManageDropdown({ onDisconnect, onSync }: ShellProps): JSX.Element {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { isOpen, open, close, containerRef } = useMenuOpenState(true, triggerRef);
    useFocusFirstItem(menuRef, isOpen);
    const pick = (action: () => void) => (): void => { close(); action(); };
    return (
        <div className="relative flex-shrink-0" ref={containerRef}>
            <Button ref={triggerRef} variant="secondary" data-testid="calendar-manage" aria-haspopup="menu"
                aria-expanded={isOpen} onClick={() => (isOpen ? close() : open())}>
                {C.manage}
            </Button>
            <div ref={menuRef} role="menu" aria-label={C.manageTitle} hidden={!isOpen} onKeyDown={onMenuKeyDown}
                data-testid="calendar-manage-menu"
                className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1">
                <ManageMenuSurface>
                    {onSync && <SyncRow onPick={pick(onSync)} />}
                    <DisconnectRow onPick={pick(onDisconnect)} />
                </ManageMenuSurface>
            </div>
        </div>
    );
}

/** <1024px: a trigger opening a sheet of 52px rows (§4.14). */
function ManageSheet({ connection, onDisconnect, onSync }: ShellProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [picking, setPicking] = useState(false);
    const close = (): void => { setOpen(false); setPicking(false); };
    const pick = (action: () => void) => (): void => { close(); action(); };
    return (
        <>
            <Button variant="secondary" data-testid="calendar-manage" aria-haspopup="dialog" aria-expanded={open}
                onClick={() => setOpen(true)}>
                {C.manage}
            </Button>
            <BottomSheet isOpen={open} onClose={close} ariaLabel={C.manageTitle}>
                {picking ? (
                    <div data-testid="calendar-picker-sheet" className="flex flex-col gap-2 pb-2">
                        <SheetTitleRow title={R.pickerLabel} onClose={close} onBack={() => setPicking(false)} />
                        <CalendarPicker connection={connection} heading={false} />
                    </div>
                ) : (
                    <div data-testid="calendar-manage-sheet" className="flex flex-col gap-1 pb-2">
                        <SheetTitleRow title={C.manageTitle} onClose={close} />
                        {onSync && <SyncRow onPick={pick(onSync)} />}
                        {onSync && <SchedulingSheetRow title={R.pickerLabel} onClick={() => setPicking(true)} testId="calendar-picker-open" />}
                        <DisconnectRow onPick={pick(onDisconnect)} />
                    </div>
                )}
            </BottomSheet>
        </>
    );
}

export function CalendarManageMenu({ connection }: { connection: CalendarConnection }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [confirming, setConfirming] = useState(false);
    const disconnect = useDisconnectCalendar();
    const onSync = useSyncNowAction(connection);
    const ask = (): void => { disconnect.reset(); setConfirming(true); };
    const confirm = (): void => {
        disconnect.mutate(connection.id, {
            onSuccess: () => { setConfirming(false); toast.success(C.toastDisconnected); },
        });
    };
    return (
        <>
            {isDesktop
                ? <ManageDropdown connection={connection} onDisconnect={ask} onSync={onSync} />
                : <ManageSheet connection={connection} onDisconnect={ask} onSync={onSync} />}
            <CalendarDisconnectConfirm isOpen={confirming} accountLabel={connection.accountLabel}
                isPending={disconnect.isPending} failed={disconnect.isError}
                onCancel={() => setConfirming(false)} onConfirm={confirm} />
        </>
    );
}
