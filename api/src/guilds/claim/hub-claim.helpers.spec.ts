/** ROK-2153 S2 — the pure claim helpers: D5 `suggested`, the 50 cap, the body parse. */
import type { HubClaimCandidate } from '@raid-ledger/contract';
import { HubClaimError } from './hub-claim.errors';
import {
  capCandidates,
  parseClaimBody,
  pickSuggested,
} from './hub-claim.helpers';

function cand(
  id: string,
  match: HubClaimCandidate['match'] = null,
): HubClaimCandidate {
  return {
    id,
    name: `Char ${id}`,
    subtitle: null,
    avatarUrl: null,
    detailPath: null,
    match,
    matchReason: match === null ? null : 'linked_account',
  };
}

describe('pickSuggested (D5)', () => {
  it('is null with no strong candidate', () => {
    expect(pickSuggested([cand('a'), cand('b', 'possible')])).toBeNull();
  });

  it('is the single strong candidate', () => {
    expect(pickSuggested([cand('a'), cand('b', 'strong')])?.id).toBe('b');
  });

  it('is null with two strong candidates', () => {
    expect(pickSuggested([cand('a', 'strong'), cand('b', 'strong')])).toBe(
      null,
    );
  });

  it('ignores a possible match beside one strong one', () => {
    const picked = pickSuggested([cand('p', 'possible'), cand('s', 'strong')]);
    expect(picked?.id).toBe('s');
  });
});

describe('capCandidates', () => {
  it('keeps 50 of 51 and flags truncation', () => {
    const list = Array.from({ length: 51 }, (_, i) => cand(`c${i}`));
    const out = capCandidates(list);
    expect(out.candidates).toHaveLength(50);
    expect(out.candidates[49]?.id).toBe('c49');
    expect(out.truncated).toBe(true);
  });

  it('keeps exactly 50 untruncated', () => {
    const list = Array.from({ length: 50 }, (_, i) => cand(`c${i}`));
    expect(capCandidates(list)).toEqual({ candidates: list, truncated: false });
  });

  it('keeps a pick that sits past the cutoff in the last slot', () => {
    const list = Array.from({ length: 51 }, (_, i) => cand(`c${i}`));
    const keep = list[50] ?? null;
    const out = capCandidates(list, keep);
    expect(out.candidates).toHaveLength(50);
    expect(out.candidates[49]?.id).toBe('c50');
    expect(out.candidates[48]?.id).toBe('c48');
    expect(out.truncated).toBe(true);
  });

  it('leaves the list alone when the pick is already inside the cap', () => {
    const list = Array.from({ length: 51 }, (_, i) => cand(`c${i}`));
    const out = capCandidates(list, list[3] ?? null);
    expect(out.candidates).toEqual(list.slice(0, 50));
  });
});

describe('parseClaimBody', () => {
  it('treats a missing body as no options', () => {
    expect(parseClaimBody(undefined)).toEqual({});
  });

  it('passes options through', () => {
    expect(parseClaimBody({ options: { ruleset: 'hc' } })).toEqual({
      options: { ruleset: 'hc' },
    });
  });

  it.each([[{ options: 3 }], [{ extra: true }], ['nope']])(
    'rejects %j as HUB_CLAIM_BAD_OPTIONS',
    (body) => {
      let caught: unknown;
      try {
        parseClaimBody(body);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HubClaimError);
      expect(caught instanceof HubClaimError ? caught.code : null).toBe(
        'HUB_CLAIM_BAD_OPTIONS',
      );
    },
  );
});
