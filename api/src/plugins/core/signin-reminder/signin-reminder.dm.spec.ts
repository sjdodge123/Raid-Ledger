import { ButtonStyle, ComponentType } from 'discord.js';
import {
  buildSigninReminderDm,
  signinReminderText,
} from './signin-reminder.dm';
import { discordErrorCode } from './signin-reminder.service';
import { colorForState } from '../../../discord-bot/embeds/embed-chrome.helpers';

describe('buildSigninReminderDm (ruled Q4/Q7)', () => {
  it('says type /login, links the site and carries the stop button', () => {
    const { embed, row } = buildSigninReminderDm(
      'Night Raiders',
      'https://raid.example',
    );
    expect(embed.toJSON().description).toContain(
      'Night Raiders uses Raid Ledger',
    );
    expect(embed.toJSON().description).toContain(
      'Type **/login** in any channel',
    );
    expect(embed.toJSON().color).toBe(colorForState('announcing'));
    expect(embed.toJSON().author?.name).toBe('Night Raiders');
    const [link, stop] = row.toJSON().components;
    expect(link).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: 'Open Raid Ledger',
      url: 'https://raid.example',
    });
    expect(stop).toMatchObject({
      style: ButtonStyle.Secondary,
      custom_id: 'signin_reminder:stop',
      label: "Don't remind me again",
    });
  });
  it('carries no sign-in token or link in the text', () => {
    expect(signinReminderText(null)).toMatch(
      /^👋 This community uses Raid Ledger/,
    );
    expect(signinReminderText('  ')).not.toContain('http');
  });
});

describe('discordErrorCode', () => {
  it('reads a numeric code, else null', () => {
    expect(
      discordErrorCode(Object.assign(new Error('x'), { code: 50007 })),
    ).toBe(50007);
    expect(
      discordErrorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    ).toBeNull();
    expect(discordErrorCode(new Error('x'))).toBeNull();
    expect(discordErrorCode(null)).toBeNull();
  });
});
