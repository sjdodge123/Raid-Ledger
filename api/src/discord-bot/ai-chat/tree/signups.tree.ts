import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

/** Handle "My Signups" tree path. Requires a linked RL account. */
export async function handleSignups(
  _path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (!session.userId) {
    return {
      data: null,
      emptyMessage: buildLinkPrompt(deps.clientUrl),
      buttons: [],
      isLeaf: true,
    };
  }
  return fetchUserSignups(deps, session.userId);
}

/** Build prompt telling the user to link their Discord account. */
function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Please link your Discord account to view your signups.';
  if (clientUrl) return `${base} Visit ${clientUrl}/profile to link.`;
  return base;
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
      return {
        data: null,
        emptyMessage: 'You have no upcoming signups.',
        buttons: [],
        isLeaf: true,
      };
    }
    const summary = events
      .map(
        (e: { title: string; startTime: string }) =>
          `${e.title} — ${new Date(e.startTime).toLocaleDateString()}`,
      )
      .join('\n');
    return {
      data: summary,
      emptyMessage: null,
      buttons: [],
      isLeaf: true,
      systemHint: "Summarize the user's upcoming event signups.",
    };
  } catch {
    return {
      data: null,
      emptyMessage: 'You have no upcoming signups.',
      buttons: [],
      isLeaf: true,
    };
  }
}
