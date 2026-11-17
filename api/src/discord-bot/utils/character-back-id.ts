/**
 * customId codec for the role step's Back button (ROK-2228).
 *
 * Format: `char_back:<charSelectPrefix>:<eventId>[:<suffix>]`. The
 * charSelectPrefix names the flow whose character list Back re-renders
 * (e.g. `char_select`, `reschedule_char_select`); the suffix is that flow's
 * character-list suffix (e.g. `tentative`), so a new pick continues the
 * same flow.
 */
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';

/** Decoded Back button customId. */
export interface CharacterBackTarget {
  charSelectPrefix: string;
  eventId: number;
  suffix?: string | undefined;
}

/** Build the Back button customId for a flow's character list. */
export function buildCharacterBackId(target: CharacterBackTarget): string {
  const base = `${SIGNUP_BUTTON_IDS.BACK_TO_CHARACTER}:${target.charSelectPrefix}:${target.eventId}`;
  return target.suffix ? `${base}:${target.suffix}` : base;
}

/** Parse a Back button customId; null when it is not one. */
export function parseCharacterBackId(
  customId: string,
): CharacterBackTarget | null {
  const parts = customId.split(':');
  if (parts.length < 3 || parts.length > 4) return null;
  const [action, charSelectPrefix, eventIdStr, suffix] = parts;
  if (action !== SIGNUP_BUTTON_IDS.BACK_TO_CHARACTER) return null;
  if (!charSelectPrefix || eventIdStr === undefined) return null;
  if (!/^\d+$/.test(eventIdStr)) return null;
  const eventId = parseInt(eventIdStr, 10);
  return suffix
    ? { charSelectPrefix, eventId, suffix }
    : { charSelectPrefix, eventId };
}
