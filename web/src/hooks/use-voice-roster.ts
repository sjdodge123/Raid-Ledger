import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import type { AdHocParticipantDto, EventResponseDto } from '@raid-ledger/contract';
import { resolveSocketTarget } from '../lib/socket-target';
import { getAccessToken } from '../lib/api/access-token-store';
import { socketAuth } from '../lib/api/socket-auth';
import { nativeFetch } from '../lib/api/native-fetch';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface VoiceRosterState {
  connected: boolean;
  participants: AdHocParticipantDto[];
  activeCount: number;
  status: 'live' | 'grace_period' | 'ended' | null;
  endTime: string | null;
}

/**
 * Fetch the current roster via REST so the UI is populated immediately,
 * before any WebSocket events arrive.
 */
async function fetchInitialRoster(
  eventId: number,
): Promise<{ participants: AdHocParticipantDto[]; activeCount: number } | null> {
  try {
    const token = getAccessToken();
    const res = await nativeFetch(`${API_BASE}/events/${eventId}/ad-hoc-roster`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * ROK-1821 (Codex r4): a linked server player is shown only through the
 * signup roster, never the voice panel — so a roster change refetches the
 * event's signups, or a viewer already on the page would not see the join.
 */
function invalidateSignupRoster(queryClient: ReturnType<typeof useQueryClient>, eventId: number): void {
  void queryClient.invalidateQueries({ queryKey: ['events', eventId, 'detail'], exact: true });
  void queryClient.invalidateQueries({ queryKey: ['events', eventId, 'roster'], exact: true });
}

type RosterPayload = { participants: AdHocParticipantDto[]; activeCount: number };
type SetVoiceState = React.Dispatch<React.SetStateAction<VoiceRosterState>>;

/** Trailing window that coalesces a burst of `roster:update`s (ROK-2323). */
export const ROSTER_REFETCH_DEBOUNCE_MS = 750;

/**
 * ROK-2323: the broadcast is the viewer projection (no unlinked Discord /
 * Steam ids), so the per-viewer REST roster is refetched — the owner keeps
 * the full detail. A raid-start burst would otherwise send one REST call
 * plus two invalidations per update and trip the 60/min/IP throttle, so the
 * refetch and the invalidations run once per quiet window. The latest
 * broadcast is the fallback when the refetch fails; a newer refetch
 * supersedes an older one still in flight (seq guard).
 */
function createRosterRefetcher(eventId: number, setState: SetVoiceState, queryClient: ReturnType<typeof useQueryClient>) {
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fallback: RosterPayload | null = null;
  const run = () => {
    timer = undefined;
    const seq = ++latest;
    const broadcast = fallback;
    void fetchInitialRoster(eventId).then((fresh) => {
      const next = fresh ?? broadcast;
      if (seq !== latest || !next) return;
      setState((prev) => ({ ...prev, participants: next.participants, activeCount: next.activeCount }));
    });
    invalidateSignupRoster(queryClient, eventId);
  };
  const onUpdate = (data: RosterPayload) => {
    fallback = data;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ROSTER_REFETCH_DEBOUNCE_MS);
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    latest++;
  };
  return { onUpdate, cancel };
}

function bindSocketEvents(
  socket: Socket,
  eventId: number,
  setState: SetVoiceState,
  queryClient: ReturnType<typeof useQueryClient>,
): () => void {
  socket.on('connect', () => { setState((prev) => ({ ...prev, connected: true })); socket.emit('subscribe', { eventId }); });
  socket.on('disconnect', () => setState((prev) => ({ ...prev, connected: false })));
  const refetcher = createRosterRefetcher(eventId, setState, queryClient);
  socket.on('roster:update', refetcher.onUpdate);
  socket.on('event:status', (data: { status: 'live' | 'grace_period' | 'ended' }) => {
    setState((prev) => ({ ...prev, status: data.status }));
  });
  socket.on('event:endTimeExtended', (data: { eventId: number; newEndTime: string }) => {
    setState((prev) => ({ ...prev, endTime: data.newEndTime }));
    queryClient.setQueryData<EventResponseDto>(['events', data.eventId], (old) => old ? { ...old, endTime: data.newEndTime } : old);
    queryClient.invalidateQueries({ queryKey: ['events', data.eventId, 'detail'], exact: true });
  });
  return refetcher.cancel;
}

function createVoiceSocket(
  eventId: number,
  setState: SetVoiceState,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const { url, path } = resolveSocketTarget('/ad-hoc');
  const socket = io(url, {
    path,
    auth: socketAuth,
    transports: ['websocket', 'polling'],
    // ROK-1533: socket.io-client 4.8 made `tryAllTransports` default to FALSE,
    // so a failed FIRST transport is fatal instead of falling through to the
    // next one. Websocket upgrades do not survive the reverse proxy in front
    // of every built deployment (verified against a fleet env: the websocket
    // attempt errors and the connection is abandoned), which silently killed
    // every live-refresh feature. Opting back in restores the documented
    // polling fallback while keeping websocket first where it does work.
    tryAllTransports: true,
    reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000,
  });

  const cancelRefetch = bindSocketEvents(socket, eventId, setState, queryClient);
  const cleanup = () => { cancelRefetch(); socket.emit('unsubscribe', { eventId }); socket.disconnect(); };
  return { socket, cleanup };
}

/**
 * Hook for real-time voice roster updates via WebSocket (ROK-293, ROK-530).
 *
 * Works for both ad-hoc and planned events. Fetches the initial roster via REST
 * on mount, then connects to the /ad-hoc namespace and subscribes to live
 * updates for a specific event. Automatically reconnects and cleans up on unmount.
 */
const INITIAL_VOICE_STATE: VoiceRosterState = { connected: false, participants: [], activeCount: 0, status: null, endTime: null };

function useInitialRosterFetch(eventId: number | null, setState: React.Dispatch<React.SetStateAction<VoiceRosterState>>) {
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    void fetchInitialRoster(eventId).then((data) => {
      if (cancelled || !data) return;
      setState((prev) => ({ ...prev, participants: data.participants, activeCount: data.activeCount }));
    });
    return () => { cancelled = true; };
  }, [eventId, setState]);
}

export function useVoiceRoster(eventId: number | null): VoiceRosterState {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<VoiceRosterState>(INITIAL_VOICE_STATE);

  useInitialRosterFetch(eventId, setState);

  useEffect(() => {
    if (!eventId) return;
    const { socket, cleanup } = createVoiceSocket(eventId, setState, queryClient);
    socketRef.current = socket;
    return () => { cleanup(); socketRef.current = null; };
  }, [eventId, queryClient]);

  return state;
}
