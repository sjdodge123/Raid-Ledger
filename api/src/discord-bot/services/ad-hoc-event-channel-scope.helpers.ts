/**
 * ROK-1851 — the ONE definition of "an ad-hoc event this binding may claim".
 *
 * A lobby and a game monitor bound to the same Discord channel share one
 * Quick Play (the voice spawn joins the monitor-born event instead of
 * creating its own), so the event keeps the monitor's `channel_binding_id`.
 * Every lookup that asks "which events belong to binding X" must therefore
 * accept any binding on X's Discord channel, or the lobby's card loses its
 * live link and its recap. The voice SPAWN target is not channel-scoped
 * (ROK-1888: one live Quick Play per game across all channels — see
 * `findVoiceSpawnTarget`); this helper scopes the per-binding card lookups.
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

/**
 * Events created by `bindingId` itself or by any binding on the same Discord
 * channel. The subquery joins `bindingId` to itself, so the binding's own
 * events always match.
 */
export function onBindingChannel(bindingId: string): SQL {
  return sql`${schema.events.channelBindingId} IN (
      SELECT cb.id FROM channel_bindings cb
      JOIN channel_bindings me ON me.channel_id = cb.channel_id
      WHERE me.id = ${bindingId})`;
}
