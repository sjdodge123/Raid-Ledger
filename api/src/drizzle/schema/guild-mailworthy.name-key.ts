/**
 * ROK-2148 — the ONE name key for Mailworthy rows (`guild_mailworthy_*.
 * name_key`) and for matching them against `guild_members.character_name`
 * (which has no key column). The apply (L3) writes it; the read (L4) joins
 * with it. Same normalisation as `guildNameKey`, without the 64-char slice.
 */
export function mailworthyNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}
