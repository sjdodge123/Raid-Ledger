import { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../../hooks/use-notifications';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { NotificationDropdown } from './NotificationDropdown';

/**
 * Notification bell icon with unread badge.
 * Displays notification dropdown on click.
 */
function useCloseOnScrollDown(isOpen: boolean, setIsOpen: (v: boolean) => void) {
    const scrollDirection = useScrollDirection();
    const [prevDirection, setPrevDirection] = useState(scrollDirection);
    if (scrollDirection !== prevDirection) {
        setPrevDirection(scrollDirection);
        if (scrollDirection === 'down' && isOpen) setIsOpen(false);
    }
}

function useClickOutside(ref: React.RefObject<HTMLDivElement | null>, isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;
        function handler(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) onClose();
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, ref, onClose]);
}

const BellIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
);

export function NotificationBell() {
    const [isOpen, setIsOpen] = useState(false);
    const { unreadCount } = useNotifications();
    const dropdownRef = useRef<HTMLDivElement>(null);

    useCloseOnScrollDown(isOpen, setIsOpen);
    useClickOutside(dropdownRef, isOpen, () => setIsOpen(false));

    return (
        <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsOpen(!isOpen)} className="relative flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel" aria-label="Notifications">
                <BellIcon />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold text-foreground bg-red-500 rounded-full">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>
            {isOpen && <NotificationDropdown onClose={() => setIsOpen(false)} />}
        </div>
    );
}
