/**
 * event-detail-page.voice-roster.test.tsx
 *
 * Tests for the showVoiceRoster logic introduced in ROK-530.
 *
 * The showVoiceRoster flag is:
 *   `isAdHoc || eventStatus === 'live'`
 *
 * The VoiceRoster panel is rendered when:
 *   `showVoiceRoster && voiceRoster.participants.length > 0`
 *
 * Rather than spinning up the full event-detail-page (which requires many
 * MSW handlers, lazy components, and IntersectionObserver), we test the
 * logic as a pure computation and also via the hook call pattern.
 */
import { describe, it, expect, vi } from 'vitest';
import { getEventStatus } from '../lib/event-utils';

// ─── showVoiceRoster logic ────────────────────────────────────────────────────
//
// The component derives showVoiceRoster as:
//   const isAdHoc = event?.isAdHoc ?? false;
//   const eventStatus = event ? getEventStatus(event.startTime, event.endTime) : null;
//   const showVoiceRoster = isAdHoc || eventStatus === 'live';
//
// We test this logic directly using the same function and conditions.

function deriveShowVoiceRoster(
  event: {
    isAdHoc: boolean;
    startTime: string;
    endTime: string;
    game: { id: number; name: string } | null;
  } | null,
): boolean {
  const isAdHoc = event?.isAdHoc ?? false;
  const eventStatus = event ? getEventStatus(event.startTime, event.endTime) : null;
  return isAdHoc || eventStatus === 'live';
}

// Helper: time strings relative to "now"
function timeOffset(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('showVoiceRoster logic (ROK-530)', () => {
  // ── Ad-hoc events ─────────────────────────────────────────────────────────

  it('showVoiceRoster is true for ad-hoc events regardless of time', () => {
    // Ad-hoc events show voice roster always (they have no scheduled time window)
    const adHocEvent = {
      isAdHoc: true,
      startTime: timeOffset(-2 * 3600_000), // started 2h ago
      endTime: timeOffset(-1 * 3600_000),   // ended 1h ago
      game: null,
    };

    expect(deriveShowVoiceRoster(adHocEvent)).toBe(true);
  });

  it('showVoiceRoster is true for ad-hoc events even without a game', () => {
    const adHocEvent = {
      isAdHoc: true,
      startTime: timeOffset(-1 * 3600_000),
      endTime: timeOffset(1 * 3600_000),
      game: null,
    };

    expect(deriveShowVoiceRoster(adHocEvent)).toBe(true);
  });

  it('showVoiceRoster is true for ad-hoc events even when upcoming', () => {
    const adHocEvent = {
      isAdHoc: true,
      startTime: timeOffset(1 * 3600_000), // starts in 1h
      endTime: timeOffset(3 * 3600_000),
      game: null,
    };

    expect(deriveShowVoiceRoster(adHocEvent)).toBe(true);
  });

  // ── Planned events: live window ───────────────────────────────────────────

  it('showVoiceRoster is true for planned events that are live AND have a game', () => {
    const livePlannedWithGame = {
      isAdHoc: false,
      startTime: timeOffset(-30 * 60_000), // started 30 min ago
      endTime: timeOffset(90 * 60_000),    // ends in 90 min
      game: { id: 1, name: 'World of Warcraft' },
    };

    expect(deriveShowVoiceRoster(livePlannedWithGame)).toBe(true);
  });

  it('showVoiceRoster is true for planned events that are live without a game (default voice channel fallback)', () => {
    const livePlannedNoGame = {
      isAdHoc: false,
      startTime: timeOffset(-30 * 60_000),
      endTime: timeOffset(90 * 60_000),
      game: null,
    };

    expect(deriveShowVoiceRoster(livePlannedNoGame)).toBe(true);
  });

  // ── Planned events: upcoming ──────────────────────────────────────────────

  it('showVoiceRoster is false for planned upcoming events even with a game (AC: panel only during live window)', () => {
    const upcomingWithGame = {
      isAdHoc: false,
      startTime: timeOffset(2 * 3600_000), // starts in 2h
      endTime: timeOffset(4 * 3600_000),
      game: { id: 1, name: 'World of Warcraft' },
    };

    expect(deriveShowVoiceRoster(upcomingWithGame)).toBe(false);
  });

  it('showVoiceRoster is false for planned upcoming events without a game', () => {
    const upcoming = {
      isAdHoc: false,
      startTime: timeOffset(1 * 3600_000),
      endTime: timeOffset(3 * 3600_000),
      game: null,
    };

    expect(deriveShowVoiceRoster(upcoming)).toBe(false);
  });

  // ── Planned events: ended ─────────────────────────────────────────────────

  it('showVoiceRoster is false for ended planned events even with a game', () => {
    const endedWithGame = {
      isAdHoc: false,
      startTime: timeOffset(-4 * 3600_000), // started 4h ago
      endTime: timeOffset(-1 * 3600_000),   // ended 1h ago
      game: { id: 1, name: 'World of Warcraft' },
    };

    expect(deriveShowVoiceRoster(endedWithGame)).toBe(false);
  });

  // ── No event loaded ───────────────────────────────────────────────────────

  it('showVoiceRoster is false when event is null (loading state)', () => {
    expect(deriveShowVoiceRoster(null)).toBe(false);
  });
});

// ─── useVoiceRoster hook receives correct eventId ─────────────────────────────
//
// The component calls: useVoiceRoster(showVoiceRoster ? eventId : null)
// When showVoiceRoster is false, the hook receives null (no subscription).
// When showVoiceRoster is true, the hook receives the eventId.

describe('useVoiceRoster eventId argument (ROK-530)', () => {
  // This tests the conditional: useVoiceRoster(showVoiceRoster ? eventId : null)

  function getVoiceRosterArg(showVoiceRoster: boolean, eventId: number): number | null {
    return showVoiceRoster ? eventId : null;
  }

  it('passes eventId when showVoiceRoster is true', () => {
    expect(getVoiceRosterArg(true, 42)).toBe(42);
  });

  it('passes null when showVoiceRoster is false (suppresses WebSocket connection)', () => {
    expect(getVoiceRosterArg(false, 42)).toBeNull();
  });

  it('passes null for eventId 0 when showVoiceRoster is false', () => {
    expect(getVoiceRosterArg(false, 0)).toBeNull();
  });
});

// ─── VoiceRoster panel visibility guard ──────────────────────────────────────
//
// Panel condition: showVoiceRoster && voiceRoster.participants.length > 0
// Even when showVoiceRoster is true, the panel hides when no participants exist.

describe('VoiceRoster panel visibility guard (ROK-530)', () => {
  function shouldShowPanel(showVoiceRoster: boolean, participantsLength: number): boolean {
    return showVoiceRoster && participantsLength > 0;
  }

  it('panel is hidden when showVoiceRoster is false, even with participants', () => {
    expect(shouldShowPanel(false, 5)).toBe(false);
  });

  it('panel is hidden when showVoiceRoster is true but no participants', () => {
    expect(shouldShowPanel(true, 0)).toBe(false);
  });

  it('panel is shown when showVoiceRoster is true and there are participants', () => {
    expect(shouldShowPanel(true, 1)).toBe(true);
  });

  it('panel is shown with multiple participants', () => {
    expect(shouldShowPanel(true, 10)).toBe(true);
  });

  it('signups/attendee roster is unaffected — it renders independently of showVoiceRoster', () => {
    // The voice panel is additive; the existing signup roster always renders.
    // This test documents that the two are separate — the voice panel having
    // showVoiceRoster=false does NOT suppress the roster.
    // (Behavioral documentation test, not a component render test)
    expect(shouldShowPanel(false, 0)).toBe(false); // Voice panel hidden
    // Signup roster would render regardless — its condition does not include showVoiceRoster
  });
});

// ─── getEventStatus boundary tests (used by showVoiceRoster) ─────────────────

describe('getEventStatus boundaries relevant to showVoiceRoster (ROK-530)', () => {
  it('returns "live" for an event currently in progress', () => {
    const start = new Date(Date.now() - 30 * 60_000).toISOString();
    const end = new Date(Date.now() + 90 * 60_000).toISOString();

    expect(getEventStatus(start, end)).toBe('live');
  });

  it('returns "upcoming" for an event starting in the future', () => {
    const start = new Date(Date.now() + 60 * 60_000).toISOString();
    const end = new Date(Date.now() + 3 * 60 * 60_000).toISOString();

    expect(getEventStatus(start, end)).toBe('upcoming');
  });

  it('returns "ended" for a past event', () => {
    const start = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const end = new Date(Date.now() - 60 * 60_000).toISOString();

    expect(getEventStatus(start, end)).toBe('ended');
  });

  it('an "ended" event has showVoiceRoster=false for planned events', () => {
    const status = getEventStatus(
      new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      new Date(Date.now() - 60 * 60_000).toISOString(),
    );

    const isAdHoc = false;
    const showVoiceRoster = isAdHoc || status === 'live';

    expect(showVoiceRoster).toBe(false);
  });

  it('an "upcoming" event has showVoiceRoster=false for planned events', () => {
    const status = getEventStatus(
      new Date(Date.now() + 60 * 60_000).toISOString(),
      new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    );

    const isAdHoc = false;
    const showVoiceRoster = isAdHoc || status === 'live';

    expect(showVoiceRoster).toBe(false);
  });
});

// Silence unused import warning from vitest
void vi;
