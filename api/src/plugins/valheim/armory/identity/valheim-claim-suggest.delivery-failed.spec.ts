/**
 * ROK-1933 Codex P2: a claim DM that the queue finally failed to deliver
 * gives back only its permanent pair key; the 24h keys still hold.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../../drizzle/schema';
import type { NotificationDedupService } from '../../../../notifications/notification-dedup.service';
import type { DiscordNotificationService } from '../../../../notifications/discord-notification.service';
import type { SettingsService } from '../../../../settings/settings.service';
import { claimSuggestKeys } from './valheim-claim-suggest.copy';
import {
  CLAIM_SUGGEST_TYPE,
  ValheimClaimSuggestService,
} from './valheim-claim-suggest.service';

const dedup = { releaseKey: jest.fn().mockResolvedValue(undefined) };

function service(): ValheimClaimSuggestService {
  return new ValheimClaimSuggestService(
    {} as PostgresJsDatabase<typeof schema>,
    dedup as unknown as NotificationDedupService,
    {} as DiscordNotificationService,
    {} as SettingsService,
  );
}

const released = (): string[] =>
  dedup.releaseKey.mock.calls.map(([k]: [string]) => k).sort();

beforeEach(() => jest.clearAllMocks());

describe('ValheimClaimSuggestService.onDeliveryFailed', () => {
  it('releases only the pair key of a failed claim DM', async () => {
    await service().onDeliveryFailed({
      type: CLAIM_SUGGEST_TYPE,
      userId: 42,
      payload: { profileId: 7, guildId: 3 },
    });
    expect(released()).toEqual([claimSuggestKeys.pair(7, 42)]);
  });

  it('keeps the 24h user and profile keys, so a retry waits a day', async () => {
    await service().onDeliveryFailed({
      type: CLAIM_SUGGEST_TYPE,
      userId: 42,
      payload: { profileId: 7 },
    });
    expect(released()).not.toContain(claimSuggestKeys.user(42));
    expect(released()).not.toContain(claimSuggestKeys.profile(7));
  });

  it('leaves the declined key alone', async () => {
    await service().onDeliveryFailed({
      type: CLAIM_SUGGEST_TYPE,
      userId: 42,
      payload: { profileId: 7 },
    });
    expect(released()).not.toContain(claimSuggestKeys.declined(7, 42));
  });

  it('touches nothing for another notification type', async () => {
    await service().onDeliveryFailed({
      type: 'event_reminder',
      userId: 42,
      payload: { profileId: 7 },
    });
    expect(released()).toEqual([]);
  });

  it('touches nothing when the payload carries no profile id', async () => {
    await service().onDeliveryFailed({
      type: CLAIM_SUGGEST_TYPE,
      userId: 42,
      payload: null,
    });
    expect(released()).toEqual([]);
  });

  it('swallows a release failure instead of throwing', async () => {
    dedup.releaseKey.mockRejectedValue(new Error('redis down'));
    await expect(
      service().onDeliveryFailed({
        type: CLAIM_SUGGEST_TYPE,
        userId: 42,
        payload: { profileId: 7 },
      }),
    ).resolves.toBeUndefined();
  });
});
