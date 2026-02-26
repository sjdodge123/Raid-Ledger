import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AdHocParticipantDto } from '@raid-ledger/contract';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface AdHocSocketState {
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

/**
 * Hook for real-time ad-hoc event updates via WebSocket (ROK-293).
 *
 * Fetches the initial roster via REST on mount, then connects to the /ad-hoc
 * namespace and subscribes to live updates for a specific event.
 * Automatically reconnects and cleans up on unmount.
 */
export function useAdHocSocket(eventId: number | null): AdHocSocketState {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<AdHocSocketState>({
    connected: false,
    participants: [],
    activeCount: 0,
    status: null,
    endTime: null,
  });

  // Fetch initial roster via REST so UI is never empty on load
  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    void fetchInitialRoster(eventId).then((data) => {
      if (cancelled || !data) return;
      setState((prev) => ({
        ...prev,
        participants: data.participants,
        activeCount: data.activeCount,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // WebSocket connection for live updates
  useEffect(() => {
    if (!eventId) return;

    const token = localStorage.getItem('raid_ledger_token');

    const socket = io(`${API_BASE}/ad-hoc`, {
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState((prev) => ({ ...prev, connected: true }));
      socket.emit('subscribe', { eventId });
    });

    socket.on('disconnect', () => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    socket.on(
      'roster:update',
      (data: {
        eventId: number;
        participants: AdHocParticipantDto[];
        activeCount: number;
      }) => {
        setState((prev) => ({
          ...prev,
          participants: data.participants,
          activeCount: data.activeCount,
        }));
      },
    );

    socket.on(
      'event:status',
      (data: { eventId: number; status: 'live' | 'grace_period' | 'ended' }) => {
        setState((prev) => ({ ...prev, status: data.status }));
      },
    );

    socket.on(
      'event:endTimeExtended',
      (data: { eventId: number; newEndTime: string }) => {
        setState((prev) => ({ ...prev, endTime: data.newEndTime }));
      },
    );

    return () => {
      socket.emit('unsubscribe', { eventId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [eventId]);

  return state;
}
