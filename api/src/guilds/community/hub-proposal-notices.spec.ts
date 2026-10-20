import {
  approvedNotice,
  HUB_PROPOSALS_ADMIN_URL,
  rejectedNotice,
  submittedNotice,
} from './hub-proposal-notices';

const facts = { proposalId: 7, gameName: 'BG3', hubName: 'BG3 Crew' };

describe('hub proposal notices', () => {
  it('submitted goes to staff and links the admin queue', () => {
    const n = submittedNotice(3, facts, 'alice');
    expect(n).toMatchObject({ userId: 3, type: 'hub_proposal_submitted' });
    expect(n.message).toContain('alice');
    expect(n.payload).toEqual({ ...facts, url: HUB_PROPOSALS_ADMIN_URL });
  });

  it('approved links the proposer to the hub page', () => {
    const n = approvedNotice(5, facts);
    expect(n.type).toBe('hub_proposal_reviewed');
    expect(n.payload).toMatchObject({
      outcome: 'approved',
      guildId: 7,
      url: '/guilds/7',
    });
  });

  it('rejected carries the reason and no link', () => {
    const n = rejectedNotice(5, facts, 'Duplicate of BG3 Raiders');
    expect(n.message).toBe('Duplicate of BG3 Raiders');
    expect(n.payload).toMatchObject({
      outcome: 'rejected',
      reason: 'Duplicate of BG3 Raiders',
    });
    expect(n.payload).not.toHaveProperty('url');
  });
});
