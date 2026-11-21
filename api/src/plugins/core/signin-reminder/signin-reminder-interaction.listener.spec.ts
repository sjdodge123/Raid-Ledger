/**
 * ROK-2284 — `disableStopButton` greys out ONLY the stop button and keeps the
 * "Open Raid Ledger" link button live (unit; the DB half is the integration spec).
 */
import { ComponentType } from 'discord.js';
import { buildSigninReminderDm } from './signin-reminder.dm';
import { SIGNIN_REMINDER_BUTTON_IDS } from './signin-reminder.constants';
import { disableStopButton } from './signin-reminder-interaction.listener';

interface ButtonJson {
  type: number;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

describe('disableStopButton', () => {
  it('disables the stop button and leaves the link button enabled', () => {
    const { row } = buildSigninReminderDm('Guild', 'https://raid.example');
    // Raw API JSON (discord.js's ActionRow constructor is private); the
    // helper reads every button through ButtonBuilder, so both shapes work.
    const rows = disableStopButton([row.toJSON()] as never);
    expect(rows).toHaveLength(1);
    const buttons = (rows[0]?.toJSON().components ?? []) as ButtonJson[];
    expect(buttons.map((b) => b.type)).toEqual([
      ComponentType.Button,
      ComponentType.Button,
    ]);
    const link = buttons.find((b) => b.url === 'https://raid.example');
    const stop = buttons.find(
      (b) => b.custom_id === SIGNIN_REMINDER_BUTTON_IDS.STOP,
    );
    expect(link?.disabled ?? false).toBe(false);
    expect(stop?.disabled).toBe(true);
  });

  it('returns no rows for a message without components', () => {
    expect(disableStopButton([] as never)).toEqual([]);
  });
});
