/**
 * Live scheduling-poll votes (ROK-1551, S2-AC1..AC3).
 *
 * The poll page joins the existing `lineup:<id>` room and refetches when the
 * server broadcasts `lineup:schedule-changed` for its match. While the socket
 * is down, an open poll falls back to a 10s `refetchInterval`. Nothing is
 * opened or polled for a locked-in / cancelled / expired poll.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  LineupRealtimeEventNames,
  LineupScheduleChangedEventSchema,
  type SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { createLineupSocket } from './use-lineup-realtime';
import { PARTICIPANTS_KEY } from './use-lineups';
import {
  SCHEDULE_VOTE_MUTATION_KEY,
  schedulePollKey,
  useSchedulePoll,
} from './use-scheduling';

/** Fallback poll cadence while the socket is disconnected (S2-AC1 ≤10s budget). */
export const LIVE_FALLBACK_INTERVAL_MS = 10_000;

/**
 * `refetchInterval` rule for the poll page: poll only an OPEN poll, and only
 * while the socket cannot deliver the change itself.
 *
 * @param data - The poll's cached page response (undefined before first load).
 * @param connected - Whether the realtime socket is currently connected.
 * @returns The interval in ms, or `false` for no polling.
 */
export function liveRefetchInterval(
  data: SchedulePollPageResponseDto | undefined,
  connected: boolean,
): number | false {
  return data?.pollStatus === 'open' && !connected ? LIVE_FALLBACK_INTERVAL_MS : false;
}

/**
 * React to one schedule-changed broadcast. Skips other matches and any
 * moment a vote mutation is in flight (its own `onSettled` invalidates, and a
 * refetch landing first would clobber the optimistic tick). A hidden tab only
 * marks the views stale; `refetchOnWindowFocus` catches up on return.
 */
function handleScheduleChanged(
  qc: QueryClient, lineupId: number, matchId: number, payload: unknown,
): void {
  const parsed = LineupScheduleChangedEventSchema.safeParse(payload);
  if (!parsed.success || parsed.data.matchId !== matchId) return;
  if (qc.isMutating({ mutationKey: [...SCHEDULE_VOTE_MUTATION_KEY] }) > 0) return;
  const scope: { refetchType?: 'none' } =
    document.visibilityState === 'visible' ? {} : { refetchType: 'none' };
  void qc.invalidateQueries({ queryKey: schedulePollKey(lineupId, matchId), ...scope });
  void qc.invalidateQueries({ queryKey: [...PARTICIPANTS_KEY, lineupId, matchId], ...scope });
}

/**
 * Open the lineup socket for one poll and wire its listeners.
 * @returns The teardown (unsubscribe, remove listeners, disconnect).
 */
function connectPollSocket(
  qc: QueryClient, lineupId: number, matchId: number, onConnection: (next: boolean) => void,
): () => void {
  const socket = createLineupSocket(lineupId);
  const onConnect = (): void => onConnection(true);
  const onDisconnect = (): void => onConnection(false);
  const onChanged = (payload: unknown): void => handleScheduleChanged(qc, lineupId, matchId, payload);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on(LineupRealtimeEventNames.ScheduleChanged, onChanged);
  if (socket.connected) onConnect();
  return () => {
    socket.emit(LineupRealtimeEventNames.Unsubscribe, { lineupId });
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off(LineupRealtimeEventNames.ScheduleChanged, onChanged);
    socket.disconnect();
    onDisconnect();
  };
}

/**
 * Subscribe an open poll to live vote changes.
 *
 * @param lineupId - The poll's lineup (socket room).
 * @param matchId - The poll's match; events for other matches are ignored.
 * @param isOpen - `pollStatus === 'open'`; false opens no socket.
 * @param connectedRef - Optional ref mirrored synchronously on connect/disconnect,
 *   so a `refetchInterval` function reads the current state on the next render.
 * @returns Whether the socket is connected.
 */
export function useSchedulePollRealtime(
  lineupId: number, matchId: number, isOpen: boolean,
  connectedRef?: MutableRefObject<boolean>,
): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isOpen || !lineupId || !matchId) return;
    return connectPollSocket(qc, lineupId, matchId, (next) => {
      if (connectedRef) connectedRef.current = next;
      setConnected(next);
    });
  }, [qc, lineupId, matchId, isOpen, connectedRef]);

  return { connected: isOpen && connected };
}

/**
 * The poll page query with live updates wired in: the socket while open, the
 * 10s fallback while it is disconnected.
 *
 * @param lineupId - The poll's lineup.
 * @param matchId - The poll's match.
 * @returns The `useSchedulePoll` query result.
 */
export function useLiveSchedulePoll(
  lineupId: number, matchId: number,
): UseQueryResult<SchedulePollPageResponseDto> {
  const connectedRef = useRef(false);
  const query = useSchedulePoll(lineupId, matchId, {
    refetchInterval: (q) => liveRefetchInterval(q.state.data, connectedRef.current),
  });
  useSchedulePollRealtime(lineupId, matchId, query.data?.pollStatus === 'open', connectedRef);
  return query;
}
