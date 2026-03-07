import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import type { AdHocParticipantDto, EventResponseDto } from '@raid-ledger/contract';

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
    const token = localStorage.getItem('raid_ledger_token');
    const res = await fetch(`${API_BASE}/events/${eventId}/ad-hoc-roster`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function bindSocketEvents(
  socket: Socket,
  eventId: number,
  setState: React.Dispatch<React.SetStateAction<VoiceRosterState>>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  socket.on('connect', () => { setState((prev) => ({ ...prev, connected: true })); socket.emit('subscribe', { eventId }); });
  socket.on('disconnect', () => setState((prev) => ({ ...prev, connected: false })));
  socket.on('roster:update', (data: { participants: AdHocParticipantDto[]; activeCount: number }) => {
    setState((prev) => ({ ...prev, participants: data.participants, activeCount: data.activeCount }));
  });
  socket.on('event:status', (data: { status: 'live' | 'grace_period' | 'ended' }) => {
    setState((prev) => ({ ...prev, status: data.status }));
  });
  socket.on('event:endTimeExtended', (data: { eventId: number; newEndTime: string }) => {
    setState((prev) => ({ ...prev, endTime: data.newEndTime }));
    queryClient.setQueryData<EventResponseDto>(['events', data.eventId], (old) => old ? { ...old, endTime: data.newEndTime } : old);
  });
}

function createVoiceSocket(
  eventId: number,
  setState: React.Dispatch<React.SetStateAction<VoiceRosterState>>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const token = localStorage.getItem('raid_ledger_token');
  const socket = io(`${API_BASE}/ad-hoc`, {
    auth: token ? { token } : undefined,
    transports: ['websocket', 'polling'],
    reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000,
  });

  bindSocketEvents(socket, eventId, setState, queryClient);
  const cleanup = () => { socket.emit('unsubscribe', { eventId }); socket.disconnect(); };
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
