import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { LineupRealtimeEventNames } from '@raid-ledger/contract';
import { DETAIL_KEY, LINEUPS_PREFIX } from './use-lineups';
import { TIEBREAKER_KEY } from './use-tiebreaker';
import { resolveSocketTarget } from '../lib/socket-target';

function createLineupSocket(lineupId: number): Socket {
  const token = localStorage.getItem('raid_ledger_token');
  const { url, path } = resolveSocketTarget('/lineups');
  const socket = io(url, {
    path,
    auth: token ? { token } : undefined,
    transports: ['websocket', 'polling'],
    // ROK-1533: socket.io-client 4.8 made `tryAllTransports` default to FALSE,
    // so a failed FIRST transport is fatal instead of falling through to the
    // next one. Websocket upgrades do not survive the reverse proxy in front
    // of every built deployment (verified against a fleet env: the websocket
    // attempt errors and the connection is abandoned), which silently killed
    // every live-refresh feature. Opting back in restores the documented
    // polling fallback while keeping websocket first where it does work.
    tryAllTransports: true,
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

    const handleTiebreakerOpen = () => {
      void queryClient.invalidateQueries({
        queryKey: [...TIEBREAKER_KEY, lineupId],
      });
    };

    // ROK-1253 rework: re-use `handleStatus` semantics — both events demand
    // the same detail invalidation so the banner appears (graceScheduled) or
    // disappears (status flip).
    socket.on(LineupRealtimeEventNames.Status, handleStatus);
    socket.on(LineupRealtimeEventNames.GraceScheduled, handleStatus);
    socket.on(LineupRealtimeEventNames.TiebreakerOpen, handleTiebreakerOpen);

    return () => {
      socket.emit(LineupRealtimeEventNames.Unsubscribe, { lineupId });
      socket.off(LineupRealtimeEventNames.Status, handleStatus);
      socket.off(LineupRealtimeEventNames.GraceScheduled, handleStatus);
      socket.off(LineupRealtimeEventNames.TiebreakerOpen, handleTiebreakerOpen);
      socket.disconnect();
    };
  }, [lineupId, queryClient]);
}
