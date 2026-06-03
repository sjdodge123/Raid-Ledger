import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

/** Handle "My Signups" tree path. Requires a linked RL account. */
export async function handleSignups(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (!session.userId) {
    return leaf(null, buildLinkPrompt(deps.clientUrl), deps);
  }
  return fetchUserSignups(deps, session.userId);
}

/** Build prompt telling the user to link their Discord account. */
function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Please link your Discord account to view your signups.';
  return clientUrl ? `${base} Visit ${clientUrl}/profile` : base;
}

/**
 * Build a markdown bullet for a signed-up event, deep-linking the title when a
 * clientUrl is configured and rendering the date in the viewer TZ (ROK-1112).
 */
function buildSignupBullet(
  event: { id: number; title: string; startTime: string },
  deps: AiChatDeps,
): string {
  const date = new Date(event.startTime).toLocaleDateString('en-US', {
    timeZone: deps.viewerTimezone,
  });
  // Escape `]` so a title containing one can't break out of the markdown link.
  const label = deps.clientUrl
    ? `[${event.title.replace(/\]/g, '\\]')}](${deps.clientUrl}/events/${event.id})`
    : event.title;
  return `• ${label} — ${date}`;
}

/** Fetch upcoming signups for a linked user. */
async function fetchUserSignups(
  deps: AiChatDeps,
  userId: number,
): Promise<TreeResult> {
  try {
    const result = await deps.eventsService.findUpcomingByUser(userId, 10);
    const events = result.data ?? [];
    if (events.length === 0) {
      return leaf(null, 'You have no upcoming signups.', deps);
    }
    // Render deterministically as markdown bullets (ROK-1112): dates in the
    // viewer's timezone, titles deep-linked — no LLM round-trip.
    const list = events
      .map((e: { id: number; title: string; startTime: string }) =>
        buildSignupBullet(e, deps),
      )
      .join('\n');
    return leaf(null, list, deps);
  } catch {
    return leaf(null, 'You have no upcoming signups.', deps);
  }
}

/** Helper to build a leaf result with optional web link. */
function leaf(
  data: string | null,
  emptyMessage: string | null,
  deps: AiChatDeps,
  systemHint?: string,
): TreeResult {
  const buttons = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'View Events',
          style: 'link' as const,
          url: `${deps.clientUrl}/events`,
        },
      ]
    : [];
  return { data, emptyMessage, buttons, isLeaf: true, systemHint };
}
