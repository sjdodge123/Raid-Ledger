/**
 * Tests for useLineupHero (ROK-1209).
 *
 * Composes useAuth + getLineupPersona + hasUserActedInPhase + useLineupAbortedAt
 * + getPhaseState + getLineupHeroCopy, then wires CTA `onClick` per copy variant.
 *
 * AC-14, AC-15, AC-16.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { createMockLineupDetail, createMockEntry } from '../test/lineup-factories';
import { useLineupHero } from './use-lineup-hero';

// Mock the auth hook.
vi.mock('./use-auth', () => ({
  useAuth: vi.fn(),
  isOperatorOrAdmin: vi.fn((u: { role?: string } | null) =>
    u?.role === 'operator' || u?.role === 'admin',
  ),
}));

// Mock the activity log hook (drives useLineupAbortedAt).
vi.mock('./use-activity-timeline', () => ({
  useActivityTimeline: vi.fn(),
}));

// Mock the force-resolve mutation.
vi.mock('./use-tiebreaker', () => ({
  useForceResolve: vi.fn(),
  useTiebreakerDetail: vi.fn(() => ({ data: null, isLoading: false })),
}));

// Router navigation — we pin via a vi-mocked function.
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

import { useAuth } from './use-auth';
import { useActivityTimeline } from './use-activity-timeline';
import { useForceResolve } from './use-tiebreaker';

const mockUseAuth = vi.mocked(useAuth);
const mockUseActivityTimeline = vi.mocked(useActivityTimeline);
const mockUseForceResolve = vi.mocked(useForceResolve);

const mockForceResolveMutate = vi.fn();

interface ScrollTargets {
  leaderboard: { current: HTMLElement | null };
  slotGrid: { current: HTMLElement | null };
  bracket: { current: HTMLElement | null };
}

function emptyTargets(): ScrollTargets {
  return {
    leaderboard: { current: null },
    slotGrid: { current: null },
    bracket: { current: null },
  };
}

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseActivityTimeline.mockReset();
  mockUseForceResolve.mockReset();
  mockNavigate.mockReset();
  mockForceResolveMutate.mockReset();

  mockUseAuth.mockReturnValue({
    user: { id: 99, role: 'member' },
  } as ReturnType<typeof useAuth>);
  mockUseActivityTimeline.mockReturnValue({
    data: { data: [] },
    isLoading: false,
  } as never);
  mockUseForceResolve.mockReturnValue({
    mutate: mockForceResolveMutate,
    isPending: false,
  } as never);
});

function renderHero(
  lineup: LineupDetailResponseDto,
  options: {
    tiebreaker?: Parameters<typeof useLineupHero>[0]['tiebreaker'];
    onOpenNominate?: () => void;
  } = {},
) {
  return renderHook(() =>
    useLineupHero({
      lineup,
      tiebreaker: options.tiebreaker ?? null,
      scrollTargets: emptyTargets(),
      onOpenNominate: options.onOpenNominate,
    }),
  );
}

describe('useLineupHero — happy paths per phase × persona', () => {
  it("building / invitee-not-acted returns action tone with a 'Nominate a game' CTA", () => {
    const lineup = createMockLineupDetail({ status: 'building' });
    const { result } = renderHero(lineup);
    expect(result.current.tone).toBe('action');
    expect(result.current.cta?.text).toMatch(/nominate a game/i);
  });

  it('building / invitee-acted returns waiting tone (user has 1 nomination)', () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      entries: [
        createMockEntry({
          id: 1,
          gameId: 42,
          gameName: 'Hollowforge',
          nominatedBy: { id: 99, displayName: 'Me' },
        }),
      ],
    });
    const { result } = renderHero(lineup);
    expect(result.current.tone).toBe('waiting');
    expect(result.current.headline).toMatch(/Hollowforge/);
  });

  it('voting / organizer returns action tone with advance CTA', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'operator' },
    } as ReturnType<typeof useAuth>);
    const lineup = createMockLineupDetail({
      status: 'voting',
      createdBy: { id: 1, displayName: 'Op' },
    });
    const { result } = renderHero(lineup);
    expect(result.current.cta?.text).toMatch(/advance/i);
  });

  it("decided / invitee-acted with a match returns 'Schedule {gameName}' CTA", () => {
    const lineup = createMockLineupDetail({
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      entries: [createMockEntry({ gameId: 42, gameName: 'Hollowforge' })],
      myVotes: [42],
    });
    const { result } = renderHero(lineup, {});
    expect(result.current.cta?.text).toMatch(/Schedule Hollowforge/i);
  });
});

describe('useLineupHero — CTA wiring (AC-16)', () => {
  it("building 'Nominate a game' CTA invokes onOpenNominate", () => {
    const onOpenNominate = vi.fn();
    const lineup = createMockLineupDetail({ status: 'building' });
    const { result } = renderHero(lineup, { onOpenNominate });
    act(() => {
      result.current.cta?.onClick();
    });
    expect(onOpenNominate).toHaveBeenCalledTimes(1);
  });

  it("decided 'Schedule {gameName}' CTA navigates to the schedule route", () => {
    const lineup = createMockLineupDetail({
      id: 50,
      status: 'decided',
      decidedGameId: 42,
      decidedGameName: 'Hollowforge',
      entries: [createMockEntry({ gameId: 42, gameName: 'Hollowforge' })],
      myVotes: [42],
    });
    const { result } = renderHero(lineup);
    act(() => {
      result.current.cta?.onClick();
    });
    // Route shape lives in the spec — must reference the lineup id and a route segment.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const target = mockNavigate.mock.calls[0][0] as string;
    expect(target).toMatch(/community-lineup\/50/);
    expect(target).toMatch(/schedule/);
  });

  it("aborted hero 'Back to Games' CTA navigates to /games", () => {
    mockUseActivityTimeline.mockReturnValue({
      data: {
        data: [
          {
            id: 1,
            action: 'lineup_aborted',
            actor: null,
            metadata: null,
            createdAt: '2026-04-28T15:00:00Z',
          },
        ],
      },
      isLoading: false,
    } as never);
    const lineup = createMockLineupDetail({ status: 'archived' });
    const { result } = renderHero(lineup);
    expect(result.current.tone).toBe('aborted');
    act(() => {
      result.current.cta?.onClick();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/games');
  });

  it("organizer tiebreaker hero 'Force-resolve now' calls useForceResolve.mutate", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'operator' },
    } as ReturnType<typeof useAuth>);
    const lineup = createMockLineupDetail({
      id: 50,
      status: 'voting',
      createdBy: { id: 1, displayName: 'Op' },
    });
    const tiebreaker = {
      id: 1,
      lineupId: 50,
      mode: 'bracket' as const,
      status: 'active' as const,
      tiedGameIds: [],
      originalVoteCount: 5,
      winnerGameId: null,
      roundDeadline: null,
      resolvedAt: null,
      currentRound: 1,
      totalRounds: 1,
      matchups: [],
      vetoStatus: null,
    };
    const { result } = renderHero(lineup, { tiebreaker });
    expect(result.current.cta?.text).toMatch(/force.*resolve/i);
    act(() => {
      result.current.cta?.onClick();
    });
    expect(mockForceResolveMutate).toHaveBeenCalledWith(50);
  });
});

describe('useLineupHero — privacy CTA (uninvited persona)', () => {
  it('returns disabled CTA with tooltip when user is uninvited on a private lineup', () => {
    const lineup = createMockLineupDetail({
      visibility: 'private',
      createdBy: { id: 1, displayName: 'Op' },
      invitees: [],
    });
    const { result } = renderHero(lineup);
    expect(result.current.tone).toBe('privacy');
    expect(result.current.cta?.disabled).toBe(true);
    expect(result.current.cta?.tooltip).toMatch(/coming soon/i);
  });
});
