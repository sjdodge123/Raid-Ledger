import {
  decideAutoMembership,
  isRecruitingHub,
  type AutoMembershipInput,
} from './hub-auto-membership.decision';
import type { HubCommunityMemberRow } from './community-membership.queries';
import type { HubJoinPromptRow, TaggedHub } from './hub-join-prompts.queries';

const NOW = new Date('2026-10-22T12:00:00Z');

function hub(over: Partial<TaggedHub> = {}): TaggedHub {
  return {
    hubId: 7,
    kind: 'game_community',
    status: 'active',
    hiddenAt: null,
    autoMembership: 'suggest',
    ...over,
  };
}

function member(
  over: Partial<HubCommunityMemberRow> = {},
): HubCommunityMemberRow {
  return {
    id: 1,
    guildId: 7,
    userId: 9,
    role: 'member',
    joinedAt: NOW,
    leftAt: null,
    removedBy: null,
    bannedAt: null,
    bannedBy: null,
    banReason: null,
    joinSource: 'manual',
    inviteId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function prompt(over: Partial<HubJoinPromptRow> = {}): HubJoinPromptRow {
  return {
    id: 3,
    guildId: 7,
    userId: 9,
    kind: 'suggest',
    source: 'signup',
    sourceRef: 11,
    createdAt: NOW,
    dismissedAt: null,
    ...over,
  };
}

function input(over: Partial<AutoMembershipInput> = {}): AutoMembershipInput {
  return {
    hub: hub(),
    membership: null,
    prompt: null,
    inDiscord: true,
    ...over,
  };
}

describe('decideAutoMembership (ROK-1893 §8d)', () => {
  it.each([
    ['suggest mode', input(), 'suggest'],
    [
      'auto mode, in Discord',
      input({ hub: hub({ autoMembership: 'auto' }) }),
      'auto',
    ],
    [
      'auto mode, not in Discord → suggest (R2)',
      input({ hub: hub({ autoMembership: 'auto' }), inDiscord: false }),
      'suggest',
    ],
    ['off mode', input({ hub: hub({ autoMembership: 'off' }) }), 'none'],
    ['untagged event', input({ hub: null }), 'none'],
    ['hidden hub', input({ hub: hub({ hiddenAt: NOW }) }), 'none'],
    ['proposed hub', input({ hub: hub({ status: 'proposed' }) }), 'none'],
    ['archived hub', input({ hub: hub({ status: 'archived' }) }), 'none'],
    ['not a community hub', input({ hub: hub({ kind: 'wow_guild' }) }), 'none'],
    ['already a live member', input({ membership: member() }), 'none'],
    [
      'left the hub (auto)',
      input({
        hub: hub({ autoMembership: 'auto' }),
        membership: member({ leftAt: NOW }),
      }),
      'none',
    ],
    [
      'banned (auto)',
      input({
        hub: hub({ autoMembership: 'auto' }),
        membership: member({ bannedAt: NOW }),
      }),
      'none',
    ],
    [
      'dismissed suggest',
      input({ prompt: prompt({ dismissedAt: NOW }) }),
      'none',
    ],
    [
      'dismissed suggest then auto mode',
      input({
        hub: hub({ autoMembership: 'auto' }),
        prompt: prompt({ dismissedAt: NOW }),
      }),
      'none',
    ],
    [
      'open suggest (insert is a no-op)',
      input({ prompt: prompt() }),
      'suggest',
    ],
    [
      'open suggest then auto mode',
      input({ hub: hub({ autoMembership: 'auto' }), prompt: prompt() }),
      'auto',
    ],
  ] as const)('%s → %s', (_label, given, expected) => {
    expect(decideAutoMembership(given)).toBe(expected);
  });

  it('isRecruitingHub is false for off and true for suggest/auto', () => {
    expect(isRecruitingHub(hub({ autoMembership: 'off' }))).toBe(false);
    expect(isRecruitingHub(hub({ autoMembership: 'suggest' }))).toBe(true);
    expect(isRecruitingHub(hub({ autoMembership: 'auto' }))).toBe(true);
  });
});
