import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Z_INDEX } from '../../lib/z-index';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    /** Override max sheet height (default: '60vh') */
    maxHeight?: string;
}

const EXPANDED_HEIGHT = '95vh';

export function BottomSheet({ isOpen, onClose, title, children, maxHeight = '60vh' }: BottomSheetProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragStartY = useRef<number>(0);
    const dragCurrentY = useRef<number>(0);
    const [expanded, setExpanded] = useState(false);

    // Reset expanded state when sheet closes (React-recommended derived state pattern)
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (!isOpen) {
            setExpanded(false);
        }
    }

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
        dragCurrentY.current = e.touches[0].clientY;
        // Disable transition during drag for responsive feel
        if (sheetRef.current) {
            sheetRef.current.style.transition = 'none';
        }
    };

    const handleDragMove = (e: React.TouchEvent) => {
        dragCurrentY.current = e.touches[0].clientY;
        const delta = dragCurrentY.current - dragStartY.current;

        if (!sheetRef.current) return;

        if (delta > 0) {
            // Dragging down — slide sheet down
            sheetRef.current.style.transform = `translateY(${delta}px)`;
        } else {
            // Dragging up — grow the sheet with dampened visual feedback
            const dampened = delta * 0.4;
            sheetRef.current.style.transform = `translateY(${dampened}px)`;
        }
    };

    const handleDragEnd = () => {
        const delta = dragCurrentY.current - dragStartY.current;
        const sheetHeight = sheetRef.current?.offsetHeight || 0;

        // Restore transition for snap animation
        if (sheetRef.current) {
            sheetRef.current.style.transition = '';
            sheetRef.current.style.transform = '';
        }

        if (delta < -60) {
            // Dragged up past threshold → expand
            setExpanded(true);
        } else if (delta > 0) {
            if (expanded && delta > 80) {
                // Expanded + dragged down → collapse
                setExpanded(false);
            } else if (!expanded && (delta > 150 || delta > sheetHeight * 0.4)) {
                // Collapsed + dragged down far → dismiss
                onClose();
            }
        }

        dragStartY.current = 0;
        dragCurrentY.current = 0;
    };

    const activeMaxHeight = expanded ? EXPANDED_HEIGHT : maxHeight;

    return createPortal(
        <div
            className={`fixed inset-0 overflow-hidden ${isOpen ? '' : 'pointer-events-none'}`}
            style={{ zIndex: Z_INDEX.BOTTOM_SHEET }}
        >
            <div
                className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'
                    }`}
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={title || 'Bottom sheet'}
                className={`absolute bottom-0 inset-x-0 bg-surface rounded-t-2xl shadow-2xl transition-all duration-300 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'
                    }`}
                style={{ maxHeight: activeMaxHeight }}
            >
                {/* Drag handle — swipe up to expand, swipe down to collapse/dismiss */}
                <div
                    className="flex justify-center pt-3 pb-2 cursor-grab"
                    onTouchStart={handleDragStart}
                    onTouchMove={handleDragMove}
                    onTouchEnd={handleDragEnd}
                >
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

                <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: `calc(${activeMaxHeight} - 80px)` }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}
