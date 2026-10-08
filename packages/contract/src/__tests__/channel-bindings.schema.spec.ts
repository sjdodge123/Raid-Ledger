/**
 * TDB:261 — `pruneConfigForPurpose` is the ONE AC5 config prune, shared by the
 * api write path and the admin edit form. These cases pin the key set each
 * purpose keeps (parity with the two copies it replaced).
 *
 * Runs under the contract workspace's own vitest config
 * (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  pruneConfigForPurpose,
  type BindingPurpose,
  type ChannelBindingConfig,
} from '../channel-bindings.schema.js';

const full: ChannelBindingConfig = {
  minPlayers: 3,
  autoClose: false,
  gracePeriod: 7,
  notificationChannelId: 'chan-1',
  allowJustChatting: true,
};

const keptKeys: Record<BindingPurpose, string[]> = {
  'game-announcements': ['notificationChannelId'],
  'game-voice-monitor': [
    'autoClose',
    'gracePeriod',
    'minPlayers',
    'notificationChannelId',
  ],
  'lfg-board': ['autoClose', 'gracePeriod', 'minPlayers', 'notificationChannelId'],
  'general-lobby': [
    'allowJustChatting',
    'autoClose',
    'gracePeriod',
    'minPlayers',
    'notificationChannelId',
  ],
};

describe('pruneConfigForPurpose', () => {
  it.each(Object.entries(keptKeys))(
    '%s keeps exactly %j',
    (purpose, expected) => {
      const pruned = pruneConfigForPurpose(full, purpose as BindingPurpose);
      expect(Object.keys(pruned).sort()).toEqual(expected);
    },
  );

  it('keeps the kept values unchanged', () => {
    expect(pruneConfigForPurpose(full, 'general-lobby')).toEqual(full);
  });

  it('matches the old web form output for a game voice monitor', () => {
    const formValues = {
      minPlayers: 2,
      autoClose: true,
      gracePeriod: 5,
      allowJustChatting: false,
    };
    expect(pruneConfigForPurpose(formValues, 'game-voice-monitor')).toEqual({
      minPlayers: 2,
      autoClose: true,
      gracePeriod: 5,
    });
    expect(pruneConfigForPurpose(formValues, 'game-announcements')).toEqual(
      {},
    );
  });

  it.each([null, undefined])('returns {} for %s input', (input) => {
    expect(pruneConfigForPurpose(input, 'general-lobby')).toEqual({});
  });

  it('does not mutate the input and returns a fresh object', () => {
    const input = { ...full };
    const pruned = pruneConfigForPurpose(input, 'game-announcements');
    expect(input).toEqual(full);
    expect(pruned).not.toBe(input);
  });
});
