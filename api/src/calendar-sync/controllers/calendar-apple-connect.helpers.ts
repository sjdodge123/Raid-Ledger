/**
 * ROK-1598 (spec §2.7 steps 3–5): the Apple connect's provider call, the
 * upsert and the post-connect steps, kept out of the controller.
 *
 * `connectWithPassword` failures map to fixed codes (§2.9): a
 * `ProviderAuthError` → `apple_auth_failed`; a `TransientError` /
 * `RateLimitError` (5xx, timeout, 429, refused redirect, bad XML) →
 * `apple_unavailable`; anything else → `onUnexpected` (Sentry) +
 * `apple_unavailable`. No message, email or password is ever logged.
 */
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AppleConnectErrorCode,
  AppleConnectInput,
  CalendarConnection,
} from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import type { SettingsService } from '../../settings/settings.service';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../providers/calendar-provider.errors';
import type { CalendarPasswordProvider } from '../providers/calendar-provider.registry';
import { enqueueCalendarReadSync } from '../read/calendar-read.enqueue.helpers';
import type { UpsertCalendarConnectionResult } from '../services/calendar-connect.helpers';
import { upsertPasswordConnection } from '../services/calendar-connect-password.helpers';
import { listUserConnections } from '../services/calendar-overview.helpers';
import { applyReadConsent } from '../services/calendar-read-consent.helpers';
import { enqueuePendingWriteOff } from '../write/calendar-write-off.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface AppleConnectDeps {
  db: Db;
  settings: SettingsService;
  writeQueue: Queue;
  readQueue: Queue;
  onUnexpected: (err: unknown) => void;
}

type Refused = Exclude<AppleConnectErrorCode, 'invalid_input'>;

function refusalFor(err: unknown, deps: AppleConnectDeps): Refused {
  if (err instanceof ProviderAuthError) return 'apple_auth_failed';
  if (err instanceof TransientError || err instanceof RateLimitError) {
    return 'apple_unavailable';
  }
  deps.onUnexpected(err);
  return 'apple_unavailable';
}

/** Validate against iCloud, then store. No row on any refusal. */
export async function connectApple(
  deps: AppleConnectDeps,
  provider: CalendarPasswordProvider,
  userId: number,
  input: AppleConnectInput,
): Promise<UpsertCalendarConnectionResult | { refused: Refused }> {
  let result;
  try {
    result = await provider.connectWithPassword(input);
  } catch (err) {
    return { refused: refusalFor(err, deps) };
  }
  return upsertPasswordConnection(deps.db, {
    userId,
    provider: 'apple',
    result,
  });
}

/** First connect: read on + the first sync; always: a pending write-off. */
async function postConnect(
  deps: AppleConnectDeps,
  connectionId: number,
  created: boolean,
): Promise<void> {
  if (created) {
    await applyReadConsent(deps.db, connectionId);
    await enqueueCalendarReadSync(
      {
        queue: deps.readQueue,
        isSyncEnabled: () => getCalendarSyncEnabled(deps.settings),
      },
      connectionId,
    );
  }
  const writeDeps = {
    queue: deps.writeQueue,
    isSyncEnabled: () => Promise.resolve(true),
  };
  await enqueuePendingWriteOff(deps.db, writeDeps, connectionId);
}

/**
 * The row is saved: a failure in the follow-up steps is reported (Sentry)
 * but does not fail the connect — the read cron picks the row up anyway.
 */
export async function finishAppleConnect(
  deps: AppleConnectDeps,
  userId: number,
  connectionId: number,
  created: boolean,
): Promise<CalendarConnection> {
  await postConnect(deps, connectionId, created).catch(deps.onUnexpected);
  const rows = await listUserConnections(deps.db, userId);
  const row = rows.find((c) => c.id === connectionId);
  if (!row) throw new Error('apple connection vanished after connect');
  return row;
}
