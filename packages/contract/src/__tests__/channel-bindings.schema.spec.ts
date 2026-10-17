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
  classifyBindingTriple,
  deriveBindingPurpose,
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
  // ROK-1766: a text purpose — drops every voice tuning key, like announcements.
  'quick-play-announcements': ['notificationChannelId'],
  'game-voice-monitor': [
    'autoClose',
    'gracePeriod',
    'minPlayers',
    'notificationChannelId',
  ],
  'lfg-board': [
    'autoClose',
    'gracePeriod',
    'minPlayers',
    'notificationChannelId',
  ],
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
    expect(pruneConfigForPurpose(formValues, 'game-announcements')).toEqual({});
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

/**
 * ROK-1766 — `quick-play-announcements` is a TEXT purpose that must name a game.
 * A QP binding without a game could never match a session, so it is rejected
 * with its own code rather than silently saved.
 */
describe('classifyBindingTriple — quick-play-announcements (ROK-1766)', () => {
  it('accepts a text channel bound to a game (gameId 0 is a real game)', () => {
    expect(
      classifyBindingTriple('text', 'quick-play-announcements', 42),
    ).toBeNull();
    expect(
      classifyBindingTriple('text', 'quick-play-announcements', 0),
    ).toBeNull();
  });

  it.each([null, undefined])('rejects a text binding with %s game', (g) => {
    expect(
      classifyBindingTriple('text', 'quick-play-announcements', g),
    ).toEqual({
      code: 'BINDING_QP_REQUIRES_GAME',
      field: 'gameId',
      message: 'A Quick Play Announcements binding must have a game.',
    });
  });

  it.each(['voice', 'forum'] as const)('rejects it on a %s channel', (type) => {
    const violation = classifyBindingTriple(
      type,
      'quick-play-announcements',
      42,
    );
    expect(violation?.code).toBe('BINDING_PURPOSE_WRONG_CHANNEL_TYPE');
    expect(violation?.field).toBe('bindingPurpose');
    expect(violation?.message).toContain(
      'Text channels use Announcements or Quick Play Announcements',
    );
  });

  it('leaves the plain announcements purpose game-optional on text', () => {
    expect(
      classifyBindingTriple('text', 'game-announcements', null),
    ).toBeNull();
  });

  it('is never derived — /bind cannot create it (D5)', () => {
    for (const type of ['text', 'voice', 'forum'] as const) {
      for (const game of [null, 0, 42]) {
        expect(deriveBindingPurpose(type, game)).not.toBe(
          'quick-play-announcements',
        );
      }
    }
  });
});

describe('pruneConfigForPurpose — quick-play-announcements (ROK-1766)', () => {
  it('drops the voice keys a QP text channel can never use', () => {
    expect(pruneConfigForPurpose(full, 'quick-play-announcements')).toEqual({
      notificationChannelId: 'chan-1',
    });
  });
});
