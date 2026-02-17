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

export function useInfiniteList<T>({
    queryKey,
    queryFn,
    enabled = true,
}: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
    const sentinelElRef = useRef<HTMLDivElement | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    const {
        data,
        error,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => queryFn(pageParam),
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
            lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined,
        enabled,
    });

    // Trigger fetchNextPage when sentinel is visible
    useEffect(() => {
        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { rootMargin: '200px' },
        );

        if (sentinelElRef.current) {
            observerRef.current.observe(sentinelElRef.current);
        }

        return () => {
            observerRef.current?.disconnect();
        };
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // Callback ref to attach/detach the observer
    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        sentinelElRef.current = node;
        if (observerRef.current) {
            observerRef.current.disconnect();
            if (node) {
                observerRef.current.observe(node);
            }
        }
    }, []);

    const items = data?.pages.flatMap((page) => page.data) ?? [];
    const total = data?.pages[0]?.meta.total ?? 0;

    return {
        items,
        total,
        isLoading,
        isFetchingNextPage,
        hasNextPage: hasNextPage ?? false,
        error: error as Error | null,
        sentinelRef,
        refetch: async () => {
            await refetch();
        },
    };
}
