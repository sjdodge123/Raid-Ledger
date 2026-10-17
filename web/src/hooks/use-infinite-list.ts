import { useCallback, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

interface PaginatedResponse<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages?: number;
        hasMore: boolean;
    };
}

interface UseInfiniteListOptions<T> {
    queryKey: unknown[];
    queryFn: (page: number) => Promise<PaginatedResponse<T>>;
    enabled?: boolean;
}

export interface UseInfiniteListResult<T> {
    items: T[];
    total: number;
    isLoading: boolean;
    isFetchingNextPage: boolean;
    hasNextPage: boolean;
    error: Error | null;
    sentinelRef: React.RefCallback<HTMLDivElement>;
    refetch: () => Promise<void>;
}

function useIntersectionSentinel(
    hasNextPage: boolean | undefined,
    isFetchingNextPage: boolean,
    fetchNextPage: () => void,
) {
    const sentinelElRef = useRef<HTMLDivElement | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        observerRef.current?.disconnect();
        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
            },
            { rootMargin: '200px' },
        );
        if (sentinelElRef.current) observerRef.current.observe(sentinelElRef.current);
        return () => observerRef.current?.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        sentinelElRef.current = node;
        if (observerRef.current) {
            observerRef.current.disconnect();
            if (node) observerRef.current.observe(node);
        }
    }, []);

    return sentinelRef;
}

export function useInfiniteList<T>({
    queryKey,
    queryFn,
    enabled = true,
}: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
    const { data, error, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => queryFn(pageParam),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined),
        enabled,
    });

    const sentinelRef = useIntersectionSentinel(hasNextPage, isFetchingNextPage, fetchNextPage);

    return {
        items: data?.pages.flatMap((page) => page.data) ?? [],
        total: data?.pages[0]?.meta.total ?? 0,
        isLoading,
        isFetchingNextPage,
        hasNextPage: hasNextPage ?? false,
        error: error as Error | null,
        sentinelRef,
        refetch: async () => { await refetch(); },
    };
}
