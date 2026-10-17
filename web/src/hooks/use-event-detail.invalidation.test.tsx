/**
 * ROK-1189 item 5 — every event mutation has to reach the ROK-1046 detail bundle.
 *
 * Since ROK-1046 the event-detail page reads one composite query,
 * `['events', eventId, 'detail']`. That made the cache contract fragile in a
 * way nothing tested: a mutation that invalidates only its own slice key
 * (roster, pugs, attendance) leaves the bundle stale, so the page keeps
 * rendering pre-mutation data until something else knocks the cache over.
 *
 * The ROK-1046 reviewer found exactly that bug by hand in `useRecordAttendance`
 * and flagged that the next one would be just as easy to miss. This spec is the
 * automated backstop: each hook below is driven through a real mutation and the
 * bundle query must refetch.
 *
 * The detail query is registered with a local counting `queryFn` rather than
 * MSW + the real `getEventDetail`, so the test asserts the cache contract
 * without depending on a ~100-line Zod-valid bundle fixture.
 *
 * Adding a new event mutation? Add it to MUTATIONS.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    QueryClient,
    QueryClientProvider,
    useQuery,
} from '@tanstack/react-query';

vi.mock('../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

// The hooks under test only need their network call to resolve; the invalidation
// contract lives entirely in their `onSuccess`.
vi.mock('../lib/api-client', () => ({
    signupForEvent: vi.fn().mockResolvedValue({ id: 1 }),
    cancelSignup: vi.fn().mockResolvedValue({ id: 1 }),
    confirmSignup: vi.fn().mockResolvedValue({ id: 1 }),
    updateSignupStatus: vi.fn().mockResolvedValue({ id: 1 }),
    recordAttendance: vi.fn().mockResolvedValue({ id: 1 }),
    getAttendanceSummary: vi.fn().mockResolvedValue({}),
    createPugSlot: vi.fn().mockResolvedValue({ id: 'pug-1' }),
    updatePugSlot: vi.fn().mockResolvedValue({ id: 'pug-1' }),
    deletePugSlot: vi.fn().mockResolvedValue(undefined),
    claimPugSlot: vi.fn().mockResolvedValue({ id: 'pug-1' }),
    getEventPugs: vi.fn().mockResolvedValue({ pugs: [] }),
    getRosterWithAssignments: vi.fn().mockResolvedValue({ assignments: [] }),
    updateRoster: vi.fn().mockResolvedValue({ assignments: [] }),
    selfUnassignFromRoster: vi.fn().mockResolvedValue({ assignments: [] }),
    adminRemoveUserFromEvent: vi.fn().mockResolvedValue({ assignments: [] }),
    updateEvent: vi.fn().mockResolvedValue({ id: 1 }),
}));

const { useSignup, useConfirmSignup } = await import('./use-signups');
const { useRecordAttendance } = await import('./use-attendance');
const { useCreatePug } = await import('./use-pugs');
const { useUpdateRoster } = await import('./use-roster');
const { useUpdateAutoUnbench } = await import('./use-auto-unbench');

const EVENT_ID = 4242;

/** A mutation hook plus the arguments that fire it. */
interface MutationCase {
    name: string;
    useHook: (eventId: number) => { mutate: (vars?: never) => void };
    vars?: unknown;
}

const MUTATIONS: MutationCase[] = [
    // Routed through the shared `invalidateRosterQueries` helper.
    { name: 'useSignup', useHook: useSignup as never },
    {
        name: 'useUpdateRoster',
        useHook: useUpdateRoster as never,
        vars: { assignments: [] },
    },
    // Inline explicit detail key.
    {
        name: 'useConfirmSignup',
        useHook: useConfirmSignup as never,
        vars: { signupId: 901, characterId: 'char-1' },
    },
    // The hook the ROK-1046 reviewer caught missing the detail key by hand.
    {
        name: 'useRecordAttendance',
        useHook: useRecordAttendance as never,
        vars: { signupId: 901, attendanceStatus: 'attended' },
    },
    // Routed through `invalidatePugQueries`.
    {
        name: 'useCreatePug',
        useHook: useCreatePug as never,
        vars: { discordUsername: 'Pug', role: 'dps' },
    },
    { name: 'useUpdateAutoUnbench', useHook: useUpdateAutoUnbench as never, vars: true },
];

describe.each(MUTATIONS)(
    'the event-detail bundle refetches after $name',
    ({ useHook, vars }) => {
        it('invalidates the composite detail query', async () => {
            let detailReads = 0;

            function Harness(): JSX.Element {
                // Stands in for the page's `useEventDetail`, minus the network.
                const { data } = useQuery({
                    queryKey: ['events', EVENT_ID, 'detail'],
                    queryFn: () => {
                        detailReads += 1;
                        return Promise.resolve({ reads: detailReads });
                    },
                });
                const { mutate } = useHook(EVENT_ID);
                return (
                    <>
                        <button
                            type="button"
                            onClick={() => mutate(vars as never)}
                        >
                            Mutate
                        </button>
                        <span data-testid="loaded">{data ? 'yes' : 'no'}</span>
                    </>
                );
            }

            const client = new QueryClient({
                defaultOptions: { queries: { retry: false } },
            });
            const user = userEvent.setup();
            render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            );

            // The bundle is in the cache and observed before the mutation fires.
            await waitFor(() =>
                expect(screen.getByTestId('loaded')).toHaveTextContent('yes'),
            );
            expect(detailReads).toBe(1);

            await user.click(screen.getByRole('button', { name: 'Mutate' }));

            // The mutation landed — the page's single source of truth must be
            // re-read rather than served from the pre-mutation cache.
            await waitFor(() => expect(detailReads).toBeGreaterThan(1));
        });
    },
);
