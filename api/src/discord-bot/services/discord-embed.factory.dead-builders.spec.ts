/**
 * ROK-1459 (slice A) — AC7: the dead ad-hoc / announcement builders are gone.
 *
 * TDD spec: all four builders still exist on origin/main, so the deletion
 * assertions FAIL today. The "kept" assertions are the counterweight — they
 * fail if the dev over-deletes. `buildEventUpdate` in particular is NOT dead
 * (embed-sync.processor.ts:141 calls it) despite the audit note in spec §4.
 */
import { DiscordEmbedFactory } from './discord-embed.factory';
import * as embedHelpers from './discord-embed.helpers';

const DELETED_FACTORY_METHODS = [
  'buildEventAnnouncement',
  'buildAdHocSpawnEmbed',
  'buildAdHocUpdateEmbed',
  'buildAdHocCompletedEmbed',
] as const;

const KEPT_FACTORY_METHODS = [
  'buildEventEmbed',
  'buildEventCancelled',
  'buildEventInvite',
  'buildEventUpdate',
  'buildEventRescheduling',
  'buildSchedulingPollEmbed',
] as const;

const DELETED_HELPER_EXPORTS = [
  'buildAdHocUpdateEmbed',
  'buildAdHocCompletedEmbed',
] as const;

const KEPT_HELPER_EXPORTS = [
  'buildRosterLine',
  'getMentionsForRole',
  'buildViewButton',
] as const;

describe('DiscordEmbedFactory dead builders (AC7)', () => {
  it.each(DELETED_FACTORY_METHODS)('no longer exposes %s', (method) => {
    expect(method in DiscordEmbedFactory.prototype).toBe(false);
  });

  it.each(KEPT_FACTORY_METHODS)('still exposes %s', (method) => {
    expect(
      typeof (
        DiscordEmbedFactory.prototype as unknown as Record<string, unknown>
      )[method],
    ).toBe('function');
  });
});

describe('discord-embed.helpers dead exports (AC7)', () => {
  it.each(DELETED_HELPER_EXPORTS)('no longer exports %s', (name) => {
    expect(name in embedHelpers).toBe(false);
  });

  it.each(KEPT_HELPER_EXPORTS)('still exports %s', (name) => {
    expect(
      typeof (embedHelpers as unknown as Record<string, unknown>)[name],
    ).toBe('function');
  });
});
