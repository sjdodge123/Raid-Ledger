import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Z_INDEX } from '../../lib/z-index';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragStartY = useRef<number>(0);
    const dragCurrentY = useRef<number>(0);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const handleDragStart = (e: React.TouchEvent) => {
        dragStartY.current = e.touches[0].clientY;
    };

    const handleDragMove = (e: React.TouchEvent) => {
        dragCurrentY.current = e.touches[0].clientY;
        const delta = dragCurrentY.current - dragStartY.current;

        if (delta > 0 && sheetRef.current) {
            sheetRef.current.style.transform = `translateY(${delta}px)`;
        }
    };

    const handleDragEnd = () => {
        const delta = dragCurrentY.current - dragStartY.current;
        const sheetHeight = sheetRef.current?.offsetHeight || 0;

        if (delta > 150 || delta > sheetHeight * 0.4) {
            onClose();
        }

        if (sheetRef.current) {
            sheetRef.current.style.transform = '';
        }

        dragStartY.current = 0;
        dragCurrentY.current = 0;
    };

    return createPortal(
        <div
            className={`fixed inset-0 ${isOpen ? '' : 'pointer-events-none'}`}
            style={{ zIndex: Z_INDEX.BOTTOM_SHEET }}
        >
            <div
                className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
                    isOpen ? 'opacity-100' : 'opacity-0'
                }`}
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={title || 'Bottom sheet'}
                className={`absolute bottom-0 inset-x-0 bg-surface rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
                    isOpen ? 'translate-y-0' : 'translate-y-full'
                }`}
                style={{ maxHeight: '60vh' }}
                onTouchStart={handleDragStart}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
            >
                <div className="flex justify-center pt-3 pb-2">
                    <div className="w-10 h-1 bg-muted rounded-full" />
                </div>

                {title && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
                        <h3 className="text-lg font-semibold">{title}</h3>
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-foreground transition-colors"
                            aria-label="Close"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>
                )}

                <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: 'calc(60vh - 80px)' }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}
