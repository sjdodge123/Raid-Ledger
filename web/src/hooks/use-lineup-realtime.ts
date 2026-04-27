import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { LineupRealtimeEventNames } from '@raid-ledger/contract';
import { DETAIL_KEY, LINEUPS_PREFIX } from './use-lineups';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function createLineupSocket(lineupId: number): Socket {
  const token = localStorage.getItem('raid_ledger_token');
  const socket = io(`${API_BASE}/lineups`, {
    auth: token ? { token } : undefined,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  if (socket.connected) {
    socket.emit(LineupRealtimeEventNames.Subscribe, { lineupId });
  } else {
    socket.on('connect', () => {
      socket.emit(LineupRealtimeEventNames.Subscribe, { lineupId });
    });
  }

  return socket;
}

/**
 * Hook for real-time lineup status updates via WebSocket (ROK-1118).
 *
 * Connects to the `/lineups` namespace, subscribes to phase-change events for
 * the given lineup, and invalidates the React Query detail/list caches when
 * the server broadcasts `lineup:status`. Per-hook lifecycle: each call owns
 * its own socket and tears it down on unmount.
 */
export function useLineupRealtime(lineupId: number | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lineupId === undefined) return;

    const socket = createLineupSocket(lineupId);

    const handleStatus = () => {
      void queryClient.invalidateQueries({
        queryKey: [...DETAIL_KEY, lineupId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...LINEUPS_PREFIX],
      });
    };

    socket.on(LineupRealtimeEventNames.Status, handleStatus);

    return () => {
      socket.emit(LineupRealtimeEventNames.Unsubscribe, { lineupId });
      socket.off(LineupRealtimeEventNames.Status, handleStatus);
      socket.disconnect();
    };
  }, [lineupId, queryClient]);
}
