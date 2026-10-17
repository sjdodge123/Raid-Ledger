/**
 * ROK-1494 D7/AC2 — the insert values for an LFG-born "playing now" event.
 *
 * These four columns are load-bearing well beyond this file:
 *   - `channelBindingId: null` is the PROVENANCE discriminator every LFG-born
 *     read keys off (`lfg-now-voice.helpers.ts`, `readPlayingNow`).
 *   - `ephemeralVoiceEnabled: true` is the reason an admin sees for a channel
 *     that appeared while the master toggle was off (the Q2 bypass, AC2).
 *   - `privateVoice: false` — the session is open; a lock would defeat the
 *     "join voice" link the group page renders.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import * as schema from '../../drizzle/schema';
import {
  buildLfgNowEventValues,
  buildLfgNowTitle,
} from './lfg-now-event.helpers';
import {
  LFG_NOW_EVENT_DURATION_MINUTES,
  LFG_NOW_FALLBACK_GAME_NAME,
  LFG_NOW_TITLE_SUFFIX,
} from './lfg-now.constants';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = new Date('2026-09-06T12:00:00.000Z');

describe('buildLfgNowEventValues', () => {
  it('marks the row LFG-born, ephemeral-voice on and NOT private (AC2/D7)', () => {
    const values = buildLfgNowEventValues(
      'Deep Rock — Playing now',
      42,
      7,
      NOW,
    );
    expect(values.channelBindingId).toBeNull();
    expect(values.ephemeralVoiceEnabled).toBe(true);
    expect(values.privateVoice).toBe(false);
    expect(values.isAdHoc).toBe(true);
    expect(values.adHocStatus).toBe('live');
  });

  it('opens the session now and closes it one duration later', () => {
    const values = buildLfgNowEventValues('t', 42, 7, NOW);
    const [start, end] = values.duration;
    expect(start).toEqual(NOW);
    expect(end.getTime() - start.getTime()).toBe(
      LFG_NOW_EVENT_DURATION_MINUTES * 60 * 1000,
    );
  });

  it('sends no reminders — a session that starts now has nothing to remind', () => {
    const values = buildLfgNowEventValues('t', 42, 7, NOW);
    expect(values.reminder15min).toBe(false);
    expect(values.reminder1hour).toBe(false);
    expect(values.reminder24hour).toBe(false);
  });
});

describe('buildLfgNowTitle', () => {
  it('suffixes the game name with the shared marker', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([{ name: 'Deep Rock Galactic' }]);
    await expect(buildLfgNowTitle(db as unknown as Db, 42)).resolves.toBe(
      `Deep Rock Galactic — ${LFG_NOW_TITLE_SUFFIX}`,
    );
  });

  it('falls back rather than titling the session "undefined"', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    await expect(buildLfgNowTitle(db as unknown as Db, 42)).resolves.toBe(
      `${LFG_NOW_FALLBACK_GAME_NAME} — ${LFG_NOW_TITLE_SUFFIX}`,
    );
  });
});
