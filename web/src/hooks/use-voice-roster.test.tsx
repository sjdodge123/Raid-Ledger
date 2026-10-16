/**
 * ROK-1821 (Codex r4) — a `roster:update` on the ad-hoc socket refetches the
 * event's signup roster, where a newly joined linked server player shows up
 * (they are excluded from both voice-panel groups by design).
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVoiceRoster } from './use-voice-roster';

type Handler = (data: unknown) => void;
const handlers = new Map<string, Handler>();

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (name: string, fn: Handler) => handlers.set(name, fn),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));
vi.mock('../lib/api/native-fetch', () => ({
  nativeFetch: () => Promise.resolve({ ok: false }),
}));

function renderWithClient(client: QueryClient): void {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useVoiceRoster(42), { wrapper });
}

function fire(name: string, data: unknown): void {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no socket handler bound for ${name}`);
  act(() => handler(data));
}

describe('useVoiceRoster — signup roster refresh (ROK-1821)', () => {
  beforeEach(() => handlers.clear());

  it('invalidates the event-detail bundle and roster on roster:update', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithClient(client);

    fire('roster:update', { participants: [], activeCount: 0 });

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ['events', 42, 'detail'], exact: true },
      { queryKey: ['events', 42, 'roster'], exact: true },
    ]);
  });
});
