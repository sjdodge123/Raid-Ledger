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
export function handlePolls(
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'polls') return Promise.resolve(pollsMenu());
  if (path === 'polls:active') {
    return Promise.resolve(fetchActivePolls(deps));
  }
  if (path === 'polls:my-votes') {
    return Promise.resolve(fetchMyVotes(deps, session));
  }
  return Promise.resolve(pollsMenu());
}

/** Fetch active scheduling polls. */
function fetchActivePolls(deps: AiChatDeps): TreeResult {
  return leaf(null, 'No active polls right now. Check back later!', deps);
}

/** Fetch user's poll votes (requires linked account). */
function fetchMyVotes(deps: AiChatDeps, session: TreeSession): TreeResult {
  if (!session.userId) {
    return leaf(null, buildLinkPrompt(deps.clientUrl), deps);
  }
  return leaf(null, "You haven't voted in any active polls.", deps);
}

function buildLinkPrompt(clientUrl: string | null): string {
  const base = 'Link your Discord account to see your votes.';
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
          url: `${deps.clientUrl}/games`,
        },
      ]
    : [];
  return { data, emptyMessage, buttons, isLeaf: true, systemHint };
}
