import { useCallback, useRef, useState, type ReactNode } from 'react';

interface PullToRefreshProps {
    onRefresh: () => Promise<void>;
    children: ReactNode;
}

const THRESHOLD = 80;

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const startY = useRef(0);
    const pulling = useRef(false);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (Math.max(document.documentElement.scrollTop, document.body.scrollTop) <= 0 && !isRefreshing) {
            startY.current = e.touches[0].clientY;
            pulling.current = true;
        }
    }, [isRefreshing]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!pulling.current) return;
        const dy = e.touches[0].clientY - startY.current;
        if (dy < 0) {
            pulling.current = false;
            setPullDistance(0);
            return;
        }
        // Diminishing returns for natural feel
        const distance = Math.min(dy * 0.5, THRESHOLD * 1.5);
        setPullDistance(distance);
    }, []);

    const handleTouchEnd = useCallback(async () => {
        if (!pulling.current) return;
        pulling.current = false;
        if (pullDistance >= THRESHOLD) {
            setIsRefreshing(true);
            setPullDistance(THRESHOLD);
            try {
                await onRefresh();
            } finally {
                setIsRefreshing(false);
                setPullDistance(0);
            }
        } else {
            setPullDistance(0);
        }
    }, [pullDistance, onRefresh]);

    const progress = Math.min(pullDistance / THRESHOLD, 1);

    return (
        <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Pull indicator — mobile only */}
            <div
                className="md:hidden overflow-hidden flex items-center justify-center transition-[height] duration-200"
                style={{ height: pullDistance > 0 ? pullDistance : 0 }}
            >
                {isRefreshing ? (
                    <svg
                        className="animate-spin h-5 w-5 text-emerald-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        />
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                    </svg>
                ) : (
                    <div className="flex flex-col items-center gap-1">
                        <svg
                            className="h-5 w-5 text-muted transition-transform duration-200"
                            style={{ transform: progress >= 1 ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        <span className="text-xs text-muted">
                            {progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
                        </span>
                    </div>
                )}
            </div>
            {children}
        </div>
    );
}
