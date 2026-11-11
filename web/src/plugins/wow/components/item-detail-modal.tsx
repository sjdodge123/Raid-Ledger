import { useEffect } from 'react';
import type { EquipmentItemDto } from '@raid-ledger/contract';
import { Modal } from '../../../components/ui/modal';
import { equipSlotLabel } from '../lib/item-detail-view';
import { ItemDetailBody } from './item-detail-body';

interface ItemDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    items: EquipmentItemDto[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    gameVariant: string | null;
}

/** ←/→ page through the items; Escape, focus trap and scroll lock come from the shared Modal. */
function useArrowPaging(isOpen: boolean, total: number, currentIndex: number, onNavigate: (i: number) => void) {
    useEffect(() => {
        if (!isOpen || total === 0) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); onNavigate((currentIndex - 1 + total) % total); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate((currentIndex + 1) % total); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, total, currentIndex, onNavigate]);
}

const NAV_BUTTON = 'p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel';

function ItemModalPager({ currentIndex, total, onNavigate }: { currentIndex: number; total: number; onNavigate: (i: number) => void }) {
    return (
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-edge">
            <button type="button" onClick={() => onNavigate((currentIndex - 1 + total) % total)} className={NAV_BUTTON} aria-label="Previous item">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm text-muted">{currentIndex + 1} / {total}</span>
            <button type="button" onClick={() => onNavigate((currentIndex + 1) % total)} className={NAV_BUTTON} aria-label="Next item">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
        </div>
    );
}

/** Character-page item popup (ROK-2176: on the shared Modal; body shared with the loot compare popup). */
export function ItemDetailModal({ isOpen, onClose, items, currentIndex, onNavigate, gameVariant }: ItemDetailModalProps) {
    useArrowPaging(isOpen, items.length, currentIndex, onNavigate);
    const item = items[currentIndex];
    if (!item) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={equipSlotLabel(item.slot)} maxWidth="max-w-lg" bodyClassName="p-5 overflow-y-auto">
            <ItemModalPager currentIndex={currentIndex} total={items.length} onNavigate={onNavigate} />
            <ItemDetailBody item={item} gameVariant={gameVariant} />
        </Modal>
    );
}
