import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Build a simple game object for deliverGames() */
export function makeGame(slug: string, name: string) {
    return { slug, name, coverUrl: null };
}

/** Build a full registry game object from slug + name */
export function makeRegistryGame(slug: string, name: string, id = 1) {
    return {
        id,
        slug,
        name,
        shortName: null,
        coverUrl: null,
        colorHex: null,
        hasRoles: false,
        hasSpecs: false,
        enabled: true,
        maxCharactersPerUser: 1,
    };
}

/** Render the CalendarPage with required providers. Returns render result and the QueryClient. */
export function renderPage(CalendarPage: React.ComponentType) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <CalendarPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { ...result, queryClient };
}

/** Deliver games via the store directly (simulates what the useEffect does with registry data) */
export function deliverGames(
    games: ReturnType<typeof makeGame>[],
    reportGames: (games: ReturnType<typeof makeGame>[]) => void,
): void {
    act(() => {
        reportGames(games);
    });
}
