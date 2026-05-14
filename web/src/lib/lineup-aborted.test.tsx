/**
 * Tests for useLineupAbortedAt (ROK-1209).
 *
 * Detects whether a lineup was aborted by querying the existing
 * activity log (no contract/migration change). Drives the aborted hero
 * variant. AC-17.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ActivityTimelineResponseDto } from '@raid-ledger/contract';
import { useLineupAbortedAt } from './lineup-aborted';

// Mock the activity-timeline hook with full control over the returned shape.
vi.mock('../hooks/use-activity-timeline', () => ({
  useActivityTimeline: vi.fn(),
}));

import { useActivityTimeline } from '../hooks/use-activity-timeline';

const mockUseActivityTimeline = vi.mocked(useActivityTimeline);

function buildResponse(
  entries: ActivityTimelineResponseDto['data'],
): ActivityTimelineResponseDto {
  return { data: entries };
}

describe('useLineupAbortedAt', () => {
  beforeEach(() => {
    mockUseActivityTimeline.mockReset();
  });

  it("returns abortedAt timestamp when log contains a 'lineup_aborted' entry", () => {
    mockUseActivityTimeline.mockReturnValue({
      data: buildResponse([
        {
          id: 1,
          action: 'lineup_aborted',
          actor: { id: 1, displayName: 'Op' },
          metadata: null,
          createdAt: '2026-04-28T15:00:00Z',
        },
      ]),
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBe('2026-04-28T15:00:00Z');
    expect(result.current.reason).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('returns reason from the latest abort entry (ROK-1207)', () => {
    mockUseActivityTimeline.mockReturnValue({
      data: buildResponse([
        {
          id: 1,
          action: 'lineup_aborted',
          actor: { id: 1, displayName: 'Op' },
          metadata: { reason: 'stale, restarting' },
          createdAt: '2026-04-01T10:00:00Z',
        },
        {
          id: 2,
          action: 'lineup_aborted',
          actor: { id: 1, displayName: 'Op' },
          metadata: { reason: 'wrong scope' },
          createdAt: '2026-04-28T15:00:00Z',
        },
      ]),
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBe('2026-04-28T15:00:00Z');
    expect(result.current.reason).toBe('wrong scope');
  });

  it('returns reason = null when latest abort has no metadata.reason', () => {
    mockUseActivityTimeline.mockReturnValue({
      data: buildResponse([
        {
          id: 1,
          action: 'lineup_aborted',
          actor: null,
          metadata: { reason: '   ' },
          createdAt: '2026-04-28T15:00:00Z',
        },
      ]),
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBe('2026-04-28T15:00:00Z');
    expect(result.current.reason).toBeNull();
  });

  it("returns abortedAt = null when log has no 'lineup_aborted' entries", () => {
    mockUseActivityTimeline.mockReturnValue({
      data: buildResponse([
        {
          id: 1,
          action: 'lineup_created',
          actor: { id: 1, displayName: 'Op' },
          metadata: null,
          createdAt: '2026-04-28T15:00:00Z',
        },
      ]),
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('returns abortedAt = null and isLoading = true while loading', () => {
    mockUseActivityTimeline.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('selects the most recent abort when multiple are present', () => {
    mockUseActivityTimeline.mockReturnValue({
      data: buildResponse([
        {
          id: 1,
          action: 'lineup_aborted',
          actor: null,
          metadata: null,
          createdAt: '2026-04-01T10:00:00Z',
        },
        {
          id: 2,
          action: 'lineup_aborted',
          actor: null,
          metadata: null,
          createdAt: '2026-04-28T15:00:00Z',
        },
      ]),
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBe('2026-04-28T15:00:00Z');
  });

  it('returns abortedAt = null when activity timeline query failed (data undefined, not loading)', () => {
    // Acceptable degradation per spec edge case #6.
    mockUseActivityTimeline.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as never);

    const { result } = renderHook(() => useLineupAbortedAt(42));
    expect(result.current.abortedAt).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
