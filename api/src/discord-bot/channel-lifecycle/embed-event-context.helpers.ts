/**
 * Card-refresh hub link — ROK-1872 (ROK-1428 §2.8, §2.9).
 *
 * Every path that re-renders an event card (signup, running-late, roach-out,
 * share, the event listener) builds its own settings context; this adds the
 * event's hub link the same way the poster does, so a re-render keeps the
 * Hub button. No hub (or a failed lookup) ⇒ the context is returned as-is.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { HubLink } from '../embeds/hub-link-button.helpers';
import type { HubLinkLogger } from './hub-link.resolver';
import { hubLinkPart, resolveEventHubLink } from './embed-hub-link.helpers';

/** Any embed context carrying the client URL the link is built on. */
interface ContextWithClientUrl {
  clientUrl?: string | null;
}

/**
 * Resolve the event's hub link from `ctx.clientUrl` and spread it onto `ctx`.
 * Never throws.
 */
export async function withEventHubLink<T extends ContextWithClientUrl>(
  db: PostgresJsDatabase<typeof schema>,
  ctx: T,
  eventId: number,
  logger: HubLinkLogger,
): Promise<T & { hubLink?: HubLink }> {
  const clientUrl = ctx.clientUrl ?? null;
  const hub = await resolveEventHubLink(db, eventId, clientUrl, logger);
  return { ...ctx, ...hubLinkPart(hub) };
}
