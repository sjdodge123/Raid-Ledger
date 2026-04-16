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
    const list = events
      .map(
        (e: { title: string; startTime: string }) =>
          `${e.title} — ${new Date(e.startTime).toLocaleDateString()}`,
      )
      .join('\n');
    const context = `Question: What events am I signed up for?\nData:\n${list}`;
    return leaf(
      context,
      null,
      deps,
      'List the events the user is signed up for with dates.',
    );
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
