import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameTimeEventBlock, CharacterRole } from '@raid-ledger/contract';
import { useCancelSignup, useConfirmSignup } from '../../../hooks/use-signups';
import { SignupConfirmationModal } from '../../events/signup-confirmation-modal';
import { toast } from '../../../lib/toast';

interface EventBlockPopoverProps {
    event: GameTimeEventBlock;
    anchorRect: DOMRect;
    onClose: () => void;
}

function formatHourRange(startHour: number, endHour: number): string {
    const fmt = (h: number) => {
        const h12 = h % 12 || 12;
        return `${h12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
    };
    return `${fmt(startHour)} – ${fmt(endHour)}`;
}

function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; classes: string }> = {
        confirmed: { label: 'Confirmed', classes: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
        pending: { label: 'Pending', classes: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
        changed: { label: 'Changed', classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    };
    const { label, classes } = config[status] ?? config.pending;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${classes}`}>
            {label}
        </span>
    );
}

function computePopoverPosition(anchorRect: DOMRect) {
    const popoverHeight = 200;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const top = spaceBelow >= popoverHeight ? anchorRect.bottom + 4 : anchorRect.top - popoverHeight - 4;
    const left = Math.min(Math.max(anchorRect.left, 8), window.innerWidth - 260);
    return { top, left };
}

function useClickOutside(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
    useEffect(() => {
        const handler = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('pointerdown', handler);
        return () => document.removeEventListener('pointerdown', handler);
    }, [ref, onClose]);
}

function useCloseOnScroll(onClose: () => void) {
    useEffect(() => {
        let armed = false;
        const timer = setTimeout(() => { armed = true; }, 100);
        const handler = () => { if (armed) onClose(); };
        window.addEventListener('scroll', handler);
        return () => { clearTimeout(timer); window.removeEventListener('scroll', handler); };
    }, [onClose]);
}

async function handlePopoverConfirm(confirmSignup: ReturnType<typeof useConfirmSignup>, event: GameTimeEventBlock, selection: { characterId: string; role?: CharacterRole }, setShowModal: (v: boolean) => void) {
    try {
        await confirmSignup.mutateAsync({ signupId: event.signupId, characterId: selection.characterId });
        toast.success('Signup confirmed!');
        setShowModal(false);
    } catch { toast.error('Failed to confirm signup'); }
}

async function handlePopoverLeave(cancelSignup: ReturnType<typeof useCancelSignup>, onClose: () => void) {
    try { await cancelSignup.mutateAsync(); toast.success('Left event'); onClose(); }
    catch { toast.error('Failed to leave event'); }
}

function PopoverActions({ event, onClose }: { event: GameTimeEventBlock; onClose: () => void }) {
    const navigate = useNavigate();
    const cancelSignup = useCancelSignup(event.eventId);
    const confirmSignup = useConfirmSignup(event.eventId);
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    return (
        <>
            <div className="flex gap-2 pt-1">
                <button onClick={() => { navigate(`/events/${event.eventId}`); onClose(); }} className="flex-1 px-2 py-1.5 text-xs font-medium text-foreground bg-overlay hover:bg-faint rounded transition-colors">View Event</button>
                {event.confirmationStatus === 'pending' && (
                    <button onClick={() => setShowConfirmModal(true)} className="flex-1 px-2 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-colors">Confirm</button>
                )}
                <button onClick={() => handlePopoverLeave(cancelSignup, onClose)} disabled={cancelSignup.isPending} className="px-2 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50">
                    {cancelSignup.isPending ? '...' : 'Leave'}
                </button>
            </div>
            {showConfirmModal && (
                <SignupConfirmationModal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)}
                    onConfirm={(sel) => handlePopoverConfirm(confirmSignup, event, sel, setShowConfirmModal)} onSkip={() => setShowConfirmModal(false)}
                    isConfirming={confirmSignup.isPending} gameId={event.gameId ?? undefined} gameName={event.gameName ?? undefined} gameSlug={event.gameSlug ?? undefined} eventId={event.eventId} />
            )}
        </>
    );
}

export function EventBlockPopover({ event, anchorRect, onClose }: EventBlockPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const position = useMemo(() => computePopoverPosition(anchorRect), [anchorRect]);
    useClickOutside(popoverRef, onClose);
    useCloseOnScroll(onClose);

    return (
        <div ref={popoverRef} className="fixed z-50 w-60 bg-panel border border-edge-strong rounded-lg shadow-xl" style={{ top: position.top, left: position.left }} data-testid="event-block-popover">
            <div className="p-3 space-y-2">
                <div>
                    <h3 className="text-sm font-semibold text-foreground truncate">{event.title}</h3>
                    {event.gameName && <p className="text-xs text-muted truncate">{event.gameName}</p>}
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-xs text-secondary">{formatHourRange(event.startHour, event.endHour)}</span>
                    <StatusBadge status={event.confirmationStatus} />
                </div>
                <PopoverActions event={event} onClose={onClose} />
            </div>
        </div>
    );
}
