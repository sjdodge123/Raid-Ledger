/**
 * Shared render helpers for frontend component tests.
 *
 * Centralises the QueryClient + MemoryRouter wrapper pattern that was
 * previously copy-pasted across ~15 test files.
 */
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement, type ReactNode } from 'react';

/**
 * Create a QueryClient configured for tests (no retries, no garbage collection).
 */
export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
}

interface ProvidersOptions {
    /** Initial route entries for MemoryRouter. Default: ['/'] */
    initialEntries?: MemoryRouterProps['initialEntries'];
    /** Supply your own QueryClient (e.g., to inspect cache). */
    queryClient?: QueryClient;
}

/**
 * Render a component wrapped in QueryClientProvider + MemoryRouter.
 *
 * Returns the standard RTL result plus the `queryClient` used.
 *
 * @example
 * ```ts
 * const { getByText, queryClient } = renderWithProviders(<MyComponent />);
 * ```
 */
export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'> & ProvidersOptions,
) {
    const {
        initialEntries = ['/'],
        queryClient = createTestQueryClient(),
        ...renderOptions
    } = options ?? {};

    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={initialEntries}>
                    {children}
                </MemoryRouter>
            </QueryClientProvider>
        );
    }

    return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient };
}
