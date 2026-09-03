/**
 * ROK-1462 (slice D) — D5/D6/D8 command-reply chrome.
 *
 * Pins the author-line grammar, the `/bind` settings fields (per purpose) and
 * the `/events` author + footer fold. AC6: the shared nouns (`per game`,
 * `in channel`, `after group empties`) are pinned here as literals AND in
 * `web/src/components/admin/BindingConfigForm.test.tsx`. The two workspaces
 * cannot import each other, but both import `@raid-ledger/contract`, so the
 * nouns now come from ONE constant there and this file pins the identity.
 */
import {
  AUTO_CLOSE_LABEL,
  AUTO_CLOSE_TRIGGER_NOUN,
  BINDING_PURPOSE_LABELS,
  COMMAND_REPLY_AUTHORS,
  JUST_CHATTING_LABEL,
  MIN_PLAYERS_LABEL,
  MIN_PLAYERS_UNIT,
  bindingTitle,
  buildEventUnbindEmbed,
  buildUnbindEmbed,
  eventsListAuthorLine,
  eventsListFooterLabel,
  settingsFields,
} from './command-reply-chrome.helpers';
import {
  AUTO_CLOSE_TRIGGER_NOUN as CONTRACT_AUTO_CLOSE_NOUN,
  BINDING_PURPOSE_LABELS as CONTRACT_PURPOSE_LABELS,
  MIN_PLAYERS_UNIT as CONTRACT_MIN_PLAYERS_UNIT,
} from '@raid-ledger/contract';
import { colorForState } from '../embeds/embed-chrome.helpers';

describe('COMMAND_REPLY_AUTHORS (D5)', () => {
  it('uses one glyph + SCREAMING state per reply, with no markdown', () => {
    expect(COMMAND_REPLY_AUTHORS).toEqual({
      BIND_SAVED: '⚙ BINDING SAVED',
      EVENT_BIND_SAVED: '⚙ EVENT BINDING SAVED',
      BIND_REJECTED: '✕ BINDING REJECTED',
      BIND_CONFIRM: '⚠ CONFIRM BINDING',
      UNBIND_REMOVED: '⚙ BINDING REMOVED',
      EVENT_UNBIND_REMOVED: '⚙ EVENT BINDING REMOVED',
      EVENT_DETAIL: '📋 EVENT DETAILS',
    });
  });

  it('never carries markdown or Discord timestamp markup', () => {
    for (const line of Object.values(COMMAND_REPLY_AUTHORS)) {
      expect(line).not.toMatch(/[*_`~]|<t:|\]\(/);
    }
  });
});

describe('eventsListAuthorLine / eventsListFooterLabel (D5)', () => {
  it('folds the shown/total count into the author line', () => {
    expect(eventsListAuthorLine(3, 12)).toBe('📋 UPCOMING EVENTS · 3 of 12');
  });

  it('folds the old footer sentence into a chrome footer label', () => {
    expect(eventsListFooterLabel(3, 12)).toBe('Showing 3 of 12');
  });
});

describe('settingsFields (D6)', () => {
  it('renders a general lobby with per-game minimums and Just Chatting', () => {
    expect(
      settingsFields({
        channelName: 'general',
        purpose: 'general-lobby',
        config: { minPlayers: 2, gracePeriod: 5, allowJustChatting: true },
      }),
    ).toEqual([
      { name: 'Minimum players', value: '2 per game', inline: true },
      { name: 'Just Chatting', value: 'Enabled', inline: true },
      { name: 'Auto-close', value: '5 min after group empties', inline: true },
    ]);
  });

  it('renders a voice monitor with in-channel minimums and no Just Chatting', () => {
    const fields = settingsFields({
      channelName: 'raid-voice',
      purpose: 'game-voice-monitor',
      config: { minPlayers: 4, gracePeriod: 10 },
      gameName: 'Deep Rock Galactic',
    });
    expect(fields).toEqual([
      { name: 'Minimum players', value: '4 in channel', inline: true },
      { name: 'Auto-close', value: '10 min after group empties', inline: true },
      { name: 'Game', value: 'Deep Rock Galactic', inline: true },
    ]);
    expect(fields.map((f) => f.name)).not.toContain('Just Chatting');
  });

  it('renders Disabled when Just Chatting is off or unset', () => {
    const off = settingsFields({
      channelName: 'general',
      purpose: 'general-lobby',
      config: { allowJustChatting: false },
    });
    expect(off).toContainEqual({
      name: 'Just Chatting',
      value: 'Disabled',
      inline: true,
    });
  });

  it('falls back to the runtime defaults when config is null', () => {
    const fields = settingsFields({
      channelName: 'lobby',
      purpose: 'general-lobby',
      config: null,
    });
    expect(fields).toContainEqual({
      name: 'Minimum players',
      value: '2 per game',
      inline: true,
    });
    expect(fields).toContainEqual({
      name: 'Auto-close',
      value: '5 min after group empties',
      inline: true,
    });
  });

  it('gives an announcements bind only Series/Game when set', () => {
    expect(
      settingsFields({
        channelName: 'announcements',
        purpose: 'game-announcements',
        config: { minPlayers: 9, gracePeriod: 9 },
        seriesTitle: 'Friday Deep Dive',
        gameName: 'Valheim',
      }),
    ).toEqual([
      { name: 'Series', value: 'Friday Deep Dive', inline: true },
      { name: 'Game', value: 'Valheim', inline: true },
    ]);
  });

  it('omits Series and Game when they are not set', () => {
    const names = settingsFields({
      channelName: 'announcements',
      purpose: 'game-announcements',
    }).map((f) => f.name);
    expect(names).toEqual([]);
  });

  /**
   * D8(b) corrected: the auto-close toggle STILL EXISTS in the admin form
   * (`BindingConfigFormFields.tsx`, `config.autoClose`), so the reply must
   * render the admin's REAL choice. Stating the grace period as a fact to an
   * admin who unchecked the box is exactly the reply-vs-form drift AC5 exists
   * to prevent.
   */
  it('states the grace period when auto-close is on or unset', () => {
    for (const purpose of ['general-lobby', 'game-voice-monitor'] as const) {
      for (const config of [
        { gracePeriod: 3 },
        { gracePeriod: 3, autoClose: true },
      ]) {
        const autoClose = settingsFields({
          channelName: 'c',
          purpose,
          config,
        }).find((f) => f.name === 'Auto-close');
        expect(autoClose?.value).toBe('3 min after group empties');
      }
    }
  });

  it('renders Disabled instead of a grace period when auto-close is off', () => {
    for (const purpose of ['general-lobby', 'game-voice-monitor'] as const) {
      const autoClose = settingsFields({
        channelName: 'c',
        purpose,
        config: { gracePeriod: 3, autoClose: false },
      }).find((f) => f.name === 'Auto-close');
      expect(autoClose?.value).toBe('Disabled');
      expect(autoClose?.value).not.toMatch(/after group empties/);
    }
  });

  it('never emits markdown or a masked link in a field value', () => {
    const fields = settingsFields({
      channelName: 'general',
      purpose: 'general-lobby',
      config: { minPlayers: 2 },
      gameName: 'Valheim',
    });
    for (const field of fields) {
      expect(field.value).not.toMatch(/\]\(|<t:/);
    }
  });
});

describe('shared copy nouns (AC6)', () => {
  it('pins the nouns the admin form also uses', () => {
    expect(MIN_PLAYERS_UNIT).toEqual({
      'general-lobby': 'per game',
      'game-voice-monitor': 'in channel',
      'game-announcements': 'per game',
    });
    expect(AUTO_CLOSE_TRIGGER_NOUN).toBe('after group empties');
  });

  it('labels each purpose the way the admin purpose select does', () => {
    expect(BINDING_PURPOSE_LABELS).toEqual({
      'game-announcements': 'Announcements',
      'game-voice-monitor': 'Activity Monitor',
      'general-lobby': 'General Lobby',
    });
  });
});

describe('shared copy is the contract constant, not a copy (AC5)', () => {
  it('re-exports the same object the admin form imports', () => {
    expect(MIN_PLAYERS_UNIT).toBe(CONTRACT_MIN_PLAYERS_UNIT);
    expect(BINDING_PURPOSE_LABELS).toBe(CONTRACT_PURPOSE_LABELS);
    expect(AUTO_CLOSE_TRIGGER_NOUN).toBe(CONTRACT_AUTO_CLOSE_NOUN);
  });

  it('names the settings fields with the contract labels', () => {
    const fields = settingsFields({
      channelName: 'general',
      purpose: 'general-lobby',
      config: { minPlayers: 2, allowJustChatting: true, gracePeriod: 5 },
    });
    const names = fields.map((f) => f.name);

    expect(names).toContain(MIN_PLAYERS_LABEL);
    expect(names).toContain(AUTO_CLOSE_LABEL);
    expect(names).toContain(JUST_CHATTING_LABEL);
  });
});

describe('bindingTitle (AC2)', () => {
  it('draws #channel → Purpose in the words the admin form uses', () => {
    expect(bindingTitle('general', 'general-lobby')).toBe(
      '#general → General Lobby',
    );
    expect(bindingTitle('raid-voice', 'game-voice-monitor')).toBe(
      '#raid-voice → Activity Monitor',
    );
    expect(bindingTitle('announcements', 'game-announcements')).toBe(
      '#announcements → Announcements',
    );
  });

  it('carries no markdown and no timestamp markup', () => {
    expect(bindingTitle('general', 'general-lobby')).not.toMatch(
      /[*_`~]|<t:|\]\(/,
    );
  });
});

describe('buildUnbindEmbed (D5/AC2)', () => {
  it('is slate done with the BINDING REMOVED author line, not red', () => {
    const embed = buildUnbindEmbed('general', null).toJSON();

    expect(embed.author?.name).toBe(COMMAND_REPLY_AUTHORS.UNBIND_REMOVED);
    expect(embed.color).toBe(colorForState('done'));
    expect(embed.color).not.toBe(colorForState('cancelled'));
  });

  it('titles the removed binding #channel → Purpose, like /bind (AC2)', () => {
    const embed = buildUnbindEmbed('general', null, 'general-lobby').toJSON();

    expect(embed.title).toBe('#general → General Lobby');
    expect(embed.description).toBeUndefined();
  });

  it('falls back to the bare channel when the purpose is unknown', () => {
    const embed = buildUnbindEmbed('general', null).toJSON();

    expect(embed.title).toBe('#general');
  });

  it('adds the series scope as a Series field, not as prose', () => {
    const embed = buildUnbindEmbed(
      'general',
      'Friday Deep Dive',
      'general-lobby',
    ).toJSON();

    expect(embed.fields).toEqual([
      { name: 'Series', value: 'Friday Deep Dive', inline: true },
    ]);
  });
});

describe('buildEventUnbindEmbed (D5/AC2)', () => {
  it('is slate done with the EVENT BINDING REMOVED author line', () => {
    const embed = buildEventUnbindEmbed('Friday Deep Dive').toJSON();

    expect(embed.author?.name).toBe(COMMAND_REPLY_AUTHORS.EVENT_UNBIND_REMOVED);
    expect(embed.color).toBe(colorForState('done'));
  });

  it('titles the event and explains what the channel falls back to', () => {
    const embed = buildEventUnbindEmbed('Friday Deep Dive').toJSON();

    expect(embed.title).toBe('Friday Deep Dive');
    expect(embed.description).toMatch(/default channel/i);
  });
});
