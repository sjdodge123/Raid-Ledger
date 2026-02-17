interface InfiniteScrollSentinelProps {
    sentinelRef: React.RefCallback<HTMLDivElement>;
    isFetchingNextPage: boolean;
    hasNextPage: boolean;
    renderSkeleton?: () => React.ReactNode;
}

export function InfiniteScrollSentinel({
    sentinelRef,
    isFetchingNextPage,
    hasNextPage,
    renderSkeleton,
}: InfiniteScrollSentinelProps) {
    return (
        <>
            {/* Invisible sentinel observed by IntersectionObserver */}
            <div ref={sentinelRef} className="h-px" />

            {isFetchingNextPage && (
                renderSkeleton ? (
                    <>{renderSkeleton()}</>
                ) : (
                    <div className="flex justify-center py-6">
                        <svg
                            className="animate-spin h-6 w-6 text-muted"
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
                    </div>
                )
            )}

            {!hasNextPage && !isFetchingNextPage && (
                <div className="text-center py-6 text-dim text-sm">
                    You've reached the end
                </div>
            )}
        </>
    );
}
