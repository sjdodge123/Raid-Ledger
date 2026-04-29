/**
 * ROK-1121 — failing TDD tests for CreateEventSection majority-voter gate.
 *
 * The Create Event button on the scheduling poll page must be gated behind
 * a real participation threshold so a single voter cannot lock in a slot.
 *
 * Required formula: requiredVoters = max(2, floor(N/2) + 1) where
 * N = match.members.length.
 *
 * Override roles: operator OR admin OR lineupCreatedById === user.id.
 *
 * The same gate must apply to BOTH CreateFromSlot and RescheduleFromSlot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    MatchDetailResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { CreateEventSection } from './CreateEventSection';

// ─── Hook mocks ────────────────────────────────────────────────────────────────

const mockUseAuth = vi.fn();
const mockIsAdmin = vi.fn();
const mockIsOperatorOrAdmin = vi.fn();

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => mockUseAuth(),
    isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
    isOperatorOrAdmin: (...args: unknown[]) => mockIsOperatorOrAdmin(...args),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>(
        'react-router-dom',
    );
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

const mockRescheduleMutate = vi.fn();
vi.mock('../../hooks/use-reschedule', () => ({
    useRescheduleEvent: vi.fn(() => ({
        mutate: mockRescheduleMutate,
        isPending: false,
    })),
}));

vi.mock('../../lib/api-client', () => ({
    completeStandalonePoll: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Fixture builders ──────────────────────────────────────────────────────────

type MatchOverrides = Partial<MatchDetailResponseDto> & {
    /** New optional contract field that the dev will add (ROK-1121). */
    lineupCreatedById?: number;
    members?: MatchDetailResponseDto['members'];
};

function buildMember(
    userId: number,
    displayName: string,
): MatchDetailResponseDto['members'][number] {
    return {
        id: userId,
        matchId: 10,
        userId,
        source: 'voted',
        createdAt: '2026-01-01T00:00:00Z',
        displayName,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
    };
}

function buildMatch(overrides: MatchOverrides = {}): MatchDetailResponseDto {
    const base: MatchDetailResponseDto = {
        id: 10,
        lineupId: 1,
        gameId: 5,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 3,
        votePercentage: 75,
        fitType: 'normal',
        linkedEventId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        gameName: 'Test Game',
        gameCoverUrl: null,
        members: [
            buildMember(1, 'Alice'),
            buildMember(2, 'Bob'),
            buildMember(3, 'Carol'),
            buildMember(4, 'Dan'),
        ],
    };
    return { ...base, ...overrides } as MatchDetailResponseDto;
}

function buildSlot(
    voterIds: number[],
    overrides: Partial<ScheduleSlotWithVotesDto> = {},
): ScheduleSlotWithVotesDto {
    return {
        id: 100,
        matchId: 10,
        proposedTime: '2099-04-10T19:00:00.000Z',
        overlapScore: null,
        suggestedBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
        votes: voterIds.map((userId) => ({
            userId,
            displayName: `User ${userId}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        })),
        ...overrides,
    };
}

interface RenderArgs {
    voterIds?: number[];
    members?: MatchDetailResponseDto['members'];
    hasVoted?: boolean;
    role?: 'user' | 'operator' | 'admin';
    userId?: number;
    lineupCreatedById?: number;
    linkedEventId?: number | null;
}

function renderSection(args: RenderArgs = {}) {
    const {
        voterIds = [2],
        members,
        hasVoted = true,
        role = 'user',
        userId = 999,
        lineupCreatedById,
        linkedEventId = null,
    } = args;

    mockUseAuth.mockReturnValue({
        user: { id: userId, role, displayName: 'Test User' },
    });
    mockIsAdmin.mockReturnValue(role === 'admin');
    mockIsOperatorOrAdmin.mockReturnValue(role === 'operator' || role === 'admin');

    const slot = buildSlot(voterIds);
    const match = buildMatch({
        members:
            members ??
            [
                buildMember(1, 'Alice'),
                buildMember(2, 'Bob'),
                buildMember(3, 'Carol'),
                buildMember(4, 'Dan'),
            ],
        lineupCreatedById,
        linkedEventId,
    });

    return renderWithProviders(
        <CreateEventSection
            slots={[slot]}
            match={match}
            matchId={10}
            hasVoted={hasVoted}
            readOnly={false}
            createdEventId={null}
            linkedEventId={linkedEventId}
            matchStatus="scheduling"
        />,
    );
}

// ─── beforeEach reset ──────────────────────────────────────────────────────────

beforeEach(() => {
    mockNavigate.mockReset();
    mockRescheduleMutate.mockReset();
    mockUseAuth.mockReset();
    mockIsAdmin.mockReset();
    mockIsOperatorOrAdmin.mockReset();
});

// ─── AC1: Button disabled below threshold for non-operator who has voted ──────

describe('CreateEventSection — AC1: button disabled below threshold (non-operator)', () => {
    it('disables Create Event when distinctVoters < requiredVoters', () => {
        renderSection({ voterIds: [2], hasVoted: true, role: 'user' });

        const button = screen.getByRole('button', { name: /create event/i });
        expect(button).toBeInTheDocument();
        expect(button).toBeDisabled();
    });
});

// ─── AC2: Helper text shows X of Y wording ─────────────────────────────────────

describe('CreateEventSection — AC2: helper text X of Y when disabled', () => {
    it('renders the exact "X of Y participants have voted — Create Event unlocks when majority has chosen a time" copy', () => {
        renderSection({ voterIds: [2], hasVoted: true, role: 'user' });

        expect(
            screen.getByText(
                /1 of 4 participants have voted — Create Event unlocks when majority has chosen a time/i,
            ),
        ).toBeInTheDocument();
    });
});

// ─── AC3: Section hidden when non-operator has not voted ───────────────────────

describe('CreateEventSection — AC3: section hidden when non-operator has not voted', () => {
    it('renders nothing (no Create Event heading, no button) when !canBypass && !hasVoted', () => {
        renderSection({ voterIds: [], hasVoted: false, role: 'user' });

        expect(
            screen.queryByRole('heading', { name: /create event/i }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /create event/i }),
        ).not.toBeInTheDocument();
    });
});

// ─── AC4: Override roles always see enabled button ─────────────────────────────

describe('CreateEventSection — AC4: bypass roles see button enabled regardless of votes', () => {
    it('AC4a: operator sees Create Event enabled even when not voted and 0 voters', () => {
        renderSection({
            voterIds: [],
            hasVoted: false,
            role: 'operator',
        });

        const button = screen.getByRole('button', { name: /create event/i });
        expect(button).toBeInTheDocument();
        expect(button).toBeEnabled();
    });

    it('AC4b: admin sees Create Event enabled even when not voted and 0 voters', () => {
        renderSection({
            voterIds: [],
            hasVoted: false,
            role: 'admin',
        });

        const button = screen.getByRole('button', { name: /create event/i });
        expect(button).toBeInTheDocument();
        expect(button).toBeEnabled();
    });

    it('AC4c: lineup creator (regular role) sees Create Event enabled even when not voted', () => {
        renderSection({
            voterIds: [],
            hasVoted: false,
            role: 'user',
            userId: 42,
            lineupCreatedById: 42,
        });

        const button = screen.getByRole('button', { name: /create event/i });
        expect(button).toBeInTheDocument();
        expect(button).toBeEnabled();
    });
});

// ─── AC5: Operator below threshold → confirm modal ─────────────────────────────

describe('CreateEventSection — AC5: confirm modal when bypass user clicks below threshold', () => {
    it('shows the warning modal with the exact "Only X of Y participants have voted on this time. Create event anyway?" copy', async () => {
        const user = userEvent.setup();
        renderSection({ voterIds: [2], hasVoted: false, role: 'operator' });

        const button = screen.getByRole('button', { name: /create event/i });
        await user.click(button);

        expect(
            screen.getByText(
                /Only 1 of 4 participants have voted on this time\. Create event anyway\?/i,
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /^cancel$/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /create anyway/i }),
        ).toBeInTheDocument();
    });
});

// ─── AC6: Threshold met → no modal ─────────────────────────────────────────────

describe('CreateEventSection — AC6: no modal when threshold is met', () => {
    it('contrast: bypass-user-below-threshold opens modal AND non-bypass-user-at-threshold does NOT', async () => {
        const user = userEvent.setup();

        // First half: operator below threshold → modal MUST appear.
        // (Today's code has no modal at all, so this assertion FAILS today.)
        const { unmount } = renderSection({
            voterIds: [2],
            hasVoted: false,
            role: 'operator',
        });
        await user.click(screen.getByRole('button', { name: /create event/i }));
        expect(
            screen.getByText(/create event anyway\?/i),
        ).toBeInTheDocument();
        unmount();
        mockNavigate.mockReset();

        // Second half: non-operator with threshold met (3/4 voters) → no modal,
        // immediate navigation.
        renderSection({ voterIds: [2, 3, 4], hasVoted: true, role: 'user' });

        const button = screen.getByRole('button', { name: /create event/i });
        expect(button).toBeEnabled();
        await user.click(button);

        expect(
            screen.queryByText(/create event anyway\?/i),
        ).not.toBeInTheDocument();
        expect(mockNavigate).toHaveBeenCalledTimes(1);
        const navArg = mockNavigate.mock.calls[0][0] as string;
        expect(navArg).toMatch(/^\/events\/new\?/);
        expect(navArg).toContain('matchId=10');
    });
});

// ─── AC7: Modal Cancel / Create anyway buttons ────────────────────────────────

describe('CreateEventSection — AC7: confirm modal actions', () => {
    it('AC7a: Cancel closes the modal and does not navigate', async () => {
        const user = userEvent.setup();
        renderSection({ voterIds: [2], hasVoted: false, role: 'operator' });

        await user.click(screen.getByRole('button', { name: /create event/i }));

        const modalText = screen.getByText(/create event anyway\?/i);
        expect(modalText).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /^cancel$/i }));

        expect(
            screen.queryByText(/create event anyway\?/i),
        ).not.toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('AC7b: "Create anyway" proceeds with the original navigation', async () => {
        const user = userEvent.setup();
        renderSection({ voterIds: [2], hasVoted: false, role: 'operator' });

        await user.click(screen.getByRole('button', { name: /create event/i }));
        await user.click(
            screen.getByRole('button', { name: /create anyway/i }),
        );

        expect(mockNavigate).toHaveBeenCalledTimes(1);
        const navArg = mockNavigate.mock.calls[0][0] as string;
        expect(navArg).toMatch(/^\/events\/new\?/);
        expect(navArg).toContain('matchId=10');
    });
});

// ─── AC8: Threshold formula coverage ───────────────────────────────────────────

describe('CreateEventSection — AC8: threshold formula max(2, floor(N/2)+1)', () => {
    const cases: Array<{ n: number; required: number }> = [
        { n: 1, required: 2 },
        { n: 2, required: 2 },
        { n: 3, required: 2 },
        { n: 4, required: 3 },
        { n: 5, required: 3 },
        { n: 6, required: 4 },
    ];

    cases.forEach(({ n, required }) => {
        it(`N=${n} requires ${required} voters — button disabled with ${required - 1} voters, enabled with ${required}`, () => {
            const members = Array.from({ length: n }, (_, i) =>
                buildMember(i + 1, `User${i + 1}`),
            );

            // With required - 1 voters: still below threshold → disabled.
            const justBelow = Math.max(0, required - 1);
            const voterIdsBelow = Array.from(
                { length: justBelow },
                (_, i) => i + 1,
            );

            const { unmount } = renderSection({
                voterIds: voterIdsBelow,
                members,
                hasVoted: true,
                role: 'user',
                userId: 9999, // non-member voter so we don't accidentally hit bypass
            });

            const buttonBelow = screen.getByRole('button', {
                name: /create event/i,
            });
            expect(buttonBelow).toBeDisabled();
            unmount();

            // With required voters: meets threshold → enabled.
            const voterIdsAt = Array.from(
                { length: required },
                (_, i) => i + 1,
            );

            renderSection({
                voterIds: voterIdsAt,
                members,
                hasVoted: true,
                role: 'user',
                userId: 9999,
            });

            const buttonAt = screen.getByRole('button', {
                name: /create event/i,
            });
            expect(buttonAt).toBeEnabled();
        });
    });
});

// ─── AC9: Reschedule path also gated ───────────────────────────────────────────

describe('CreateEventSection — AC9: reschedule path is also gated', () => {
    it('disables Reschedule Event button and shows helper text when below threshold', () => {
        renderSection({
            voterIds: [2],
            hasVoted: true,
            role: 'user',
            linkedEventId: 555,
        });

        const button = screen.getByRole('button', {
            name: /reschedule event/i,
        });
        expect(button).toBeInTheDocument();
        expect(button).toBeDisabled();
        expect(
            screen.getByText(
                /1 of 4 participants have voted — Create Event unlocks when majority has chosen a time/i,
            ),
        ).toBeInTheDocument();
    });
});

// Helper export to silence "within is unused" if it isn't referenced.
void within;
