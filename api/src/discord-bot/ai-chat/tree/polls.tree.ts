import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('polls:active'), label: 'Active Polls' },
  { customId: aiCustomId('polls:my-votes'), label: 'My Votes' },
];

/** Polls sub-menu. */
function pollsMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to know about polls?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Handle "Polls" tree path. */
export async function handlePolls(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'polls') return pollsMenu();
  if (path === 'polls:active') return fetchActivePolls(deps, session);
  if (path === 'polls:my-votes') return fetchMyVotes(deps, session);
  return pollsMenu();
}

/** Fetch active scheduling polls via the banner endpoint. */
async function fetchActivePolls(
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (!session.userId) {
    return leaf(null, buildLinkPrompt(deps.clientUrl), deps);
  }
  try {
    const banner = await deps.schedulingService.getSchedulingBanner(
      session.userId,
    );
    if (!banner || banner.polls.length === 0) {
      return leaf(null, 'No active polls right now.', deps);
    }
    const list = banner.polls
      .map((p) => `• ${p.gameName} — ${p.slotCount} time slots`)
      .join('\n');
    const count = banner.polls.length;
    return leaf(null, `**Active polls (${count}):**\n${list}`, deps);
  } catch {
    return leaf(null, 'Unable to load polls right now.', deps);
  }
}

/** Fetch user's poll votes (requires linked account). */
function fetchMyVotes(deps: AiChatDeps, session: TreeSession): TreeResult {
  if (!session.userId) {
    return leaf(null, buildLinkPrompt(deps.clientUrl), deps);
  }
  return leaf(null, "You haven't voted in any active polls.", deps);
}

function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Link your Discord account to see your polls.';
  return clientUrl ? `${base} Visit ${clientUrl}/profile` : base;
}

/** Helper to build a leaf result. */
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
          label: 'View Polls',
          style: 'link' as const,
          url: `${deps.clientUrl}/events`,
        },
      ]
    : [];
  return { data, emptyMessage, buttons, isLeaf: true, systemHint };
}
