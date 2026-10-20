/**
 * ROK-1851 — the ONE definition of "an ad-hoc event this binding may claim".
 *
 * A lobby and a game monitor bound to the same Discord channel share one
 * Quick Play (the voice spawn joins the monitor-born event instead of
 * creating its own), so the event keeps the monitor's `channel_binding_id`.
 * Every lookup that asks "which events belong to binding X" must therefore
 * accept any binding on X's Discord channel, or the lobby's card loses its
 * live link and its recap. A Quick Play born on ANOTHER channel never
 * matches (ROK-1800 rule).
 */
import { isNull, or, sql, type SQL } from 'drizzle-orm';
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

/**
 * Events a voice spawn from `bindingId` may reuse: server-born (no creating
 * binding) or born on the spawning binding's Discord channel.
 */
export function bornOnSpawningChannel(bindingId: string): SQL | undefined {
  return or(
    isNull(schema.events.channelBindingId),
    onBindingChannel(bindingId),
  );
}
