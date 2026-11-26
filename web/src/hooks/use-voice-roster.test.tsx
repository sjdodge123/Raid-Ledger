/**
 * ROK-1821 (Codex r4) — a `roster:update` on the ad-hoc socket refetches the
 * event's signup roster, where a newly joined linked server player shows up
 * (they are excluded from both voice-panel groups by design).
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ROSTER_REFETCH_DEBOUNCE_MS, useVoiceRoster } from './use-voice-roster';

type Handler = (data: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (name: string, fn: Handler) => handlers.set(name, fn),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api/native-fetch', () => ({ nativeFetch: fetchMock }));

function renderWithClient(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useVoiceRoster(42), { wrapper }).result;
}

function fire(name: string, data: unknown): void {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no socket handler bound for ${name}`);
  act(() => handler(data));
}

/** Runs the trailing debounce window and settles the refetch promise chain. */
async function settleDebounce(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ROSTER_REFETCH_DEBOUNCE_MS); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useVoiceRoster — signup roster refresh (ROK-1821)', () => {
  beforeEach(() => {
    handlers.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false });
  });

  it('invalidates the event-detail bundle and roster on roster:update', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithClient(client);

    fire('roster:update', { participants: [], activeCount: 0 });
    await settleDebounce();

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ['events', 42, 'detail'], exact: true },
      { queryKey: ['events', 42, 'roster'], exact: true },
    ]);
  });
});

const ownerRow = {
  id: 'row-1', eventId: 42, userId: 3, discordUserId: '123456789012345678', hasDiscord: true,
  discordUsername: 'Owner view', discordAvatarHash: 'hash', joinedAt: '2026-11-26T10:00:00.000Z',
  leftAt: null, totalDurationSeconds: 60, sessionCount: 1,
};
const viewerRow = {
  id: 'row-1', eventId: 42, userId: 3, hasDiscord: true, discordUsername: 'Broadcast', discordAvatarHash: null,
  joinedAt: '2026-11-26T10:00:00.000Z', leftAt: null, totalDurationSeconds: 60, sessionCount: 1,
};

describe('useVoiceRoster — per-viewer refetch on roster:update (ROK-2323)', () => {
  beforeEach(() => {
    handlers.clear();
    fetchMock.mockReset();
  });

  it('replaces the id-less broadcast with the per-viewer REST roster', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const result = renderWithClient(new QueryClient());
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ participants: [ownerRow], activeCount: 1 }) });

    fire('roster:update', { participants: [viewerRow], activeCount: 1 });
    await settleDebounce();

    await vi.waitFor(() => expect(result.current.participants.map((p) => p.discordUsername)).toEqual(['Owner view']));
    expect(result.current.participants[0]?.discordUserId).toBe('123456789012345678');
  });

  it('falls back to the broadcast when the refetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const result = renderWithClient(new QueryClient());

    fire('roster:update', { participants: [viewerRow], activeCount: 1 });
    await settleDebounce();

    await vi.waitFor(() => expect(result.current.participants.map((p) => p.discordUsername)).toEqual(['Broadcast']));
  });
});

describe('useVoiceRoster — burst debounce (ROK-2323 review MAJOR)', () => {
  beforeEach(() => {
    handlers.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false });
  });

  it('coalesces N rapid roster:updates into ONE refetch and one pair of invalidations', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithClient(client);
    await act(async () => { await Promise.resolve(); });
    const afterMount = fetchMock.mock.calls.length;

    for (let i = 0; i < 6; i++) {
      fire('roster:update', { participants: [{ ...viewerRow, discordUsername: `Burst ${i}` }], activeCount: 1 });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(fetchMock.mock.calls.length - afterMount).toBe(0);

    await settleDebounce();

    expect(fetchMock.mock.calls.length - afterMount).toBe(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('falls back to the LATEST broadcast of the burst', async () => {
    const result = renderWithClient(new QueryClient());

    fire('roster:update', { participants: [{ ...viewerRow, discordUsername: 'First' }], activeCount: 1 });
    fire('roster:update', { participants: [{ ...viewerRow, discordUsername: 'Last' }], activeCount: 1 });
    await settleDebounce();

    await vi.waitFor(() => expect(result.current.participants.map((p) => p.discordUsername)).toEqual(['Last']));
  });
});
