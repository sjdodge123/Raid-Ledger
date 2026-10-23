/**
 * ROK-1933 L1 — the claim-suggest matcher: name normalisation, name strength
 * and the single-candidate pick (D6 differing Steam, D7 never on a tie).
 * Every character name here is invented.
 */
import {
  nameStrength,
  normaliseName,
  pickClaimCandidate,
  type ClaimCandidate,
  type ClaimSubject,
} from './valheim-claim-suggest.helpers';

const STEAM = '76561190000000001';
const subject = (characterName: string): ClaimSubject => ({
  profileId: 7,
  characterName,
  steamId: STEAM,
});
const cand = (
  userId: number,
  names: string[],
  extra: Partial<ClaimCandidate> = {},
): ClaimCandidate => ({
  userId,
  names,
  inVoice: false,
  steamId: null,
  ...extra,
});

describe('normaliseName', () => {
  it.each([
    ['Brannök', 'brannok'],
    ['M✿rrow', 'mrrow'],
    ['  Ëlda_Vane! ', 'eldavane'],
    ['THISTLE', 'thistle'],
    ['★☆', ''],
  ])('folds %j to %j', (raw, expected) => {
    expect(normaliseName(raw)).toBe(expected);
  });
});

describe('nameStrength', () => {
  it.each([
    ['Brannök', 'Brannok', 'strong'],
    ['brannok', 'BRANNÖK', 'strong'],
    ['M✿rrow', 'Morrow', 'medium'],
    ['Morrow', 'Morrrow', 'medium'],
    ['Halvard', 'Halvardsen', 'medium'],
    ['Thistlewick', 'Thistle', 'none'],
    ['Morrow', 'Marlow', 'none'],
    ['Ox', 'Ax', 'none'],
    ['★', '☆', 'none'],
  ])('%j vs %j is %s', (character, candidate, expected) => {
    expect(nameStrength(character, candidate)).toBe(expected);
  });
});

describe('pickClaimCandidate — names', () => {
  it('picks the single name match', () => {
    const pick = pickClaimCandidate(subject('M✿rrow'), [
      cand(1, ['Morrow']),
      cand(2, ['Halvard']),
    ]);
    expect(pick).toBe(1);
  });

  it('matches against any of the candidate names', () => {
    const pick = pickClaimCandidate(subject('Brannök'), [
      cand(1, ['jake', 'Brannok']),
    ]);
    expect(pick).toBe(1);
  });

  it('prefers the only strong match over a medium one', () => {
    const pick = pickClaimCandidate(subject('Morrow'), [
      cand(1, ['Morrrow']),
      cand(2, ['morrow']),
    ]);
    expect(pick).toBe(2);
  });

  it('returns null on a name tie', () => {
    const pick = pickClaimCandidate(subject('Brannök'), [
      cand(1, ['Brannok']),
      cand(2, ['BRANNOK']),
    ]);
    expect(pick).toBeNull();
  });

  it('never falls through to a weaker name after a tie', () => {
    const pick = pickClaimCandidate(subject('Morrow'), [
      cand(1, ['Morrow']),
      cand(2, ['MORROW']),
      cand(3, ['Morrrow'], { inVoice: true }),
    ]);
    expect(pick).toBeNull();
  });

  it('does not treat a prefix as a match', () => {
    const pick = pickClaimCandidate(subject('Thistlewick'), [
      cand(1, ['Thistle']),
    ]);
    expect(pick).toBeNull();
  });
});

describe('pickClaimCandidate — Steam and voice', () => {
  it('excludes a candidate whose linked Steam id differs', () => {
    const pick = pickClaimCandidate(subject('Brannök'), [
      cand(1, ['Brannok'], { steamId: '76561190000000999' }),
    ]);
    expect(pick).toBeNull();
  });

  it('keeps a candidate whose linked Steam id is the character’s', () => {
    const pick = pickClaimCandidate(subject('Brannök'), [
      cand(1, ['Brannok'], { steamId: STEAM }),
    ]);
    expect(pick).toBe(1);
  });

  it('a name match beats a differing-Steam exact match', () => {
    const pick = pickClaimCandidate(subject('Brannök'), [
      cand(1, ['Brannok'], { steamId: '76561190000000999' }),
      cand(2, ['Brannokk']),
    ]);
    expect(pick).toBe(2);
  });

  it('picks the lone voice candidate when no name matches', () => {
    const pick = pickClaimCandidate(subject('Morrow'), [
      cand(1, ['Halvard'], { inVoice: true }),
      cand(2, ['Ysolde']),
    ]);
    expect(pick).toBe(1);
  });

  it('returns null when two candidates are in voice and no name matches', () => {
    const pick = pickClaimCandidate(subject('Morrow'), [
      cand(1, ['Halvard'], { inVoice: true }),
      cand(2, ['Ysolde'], { inVoice: true }),
    ]);
    expect(pick).toBeNull();
  });

  it('ignores a voice candidate whose Steam differs when counting voice', () => {
    const pick = pickClaimCandidate(subject('Morrow'), [
      cand(1, ['Halvard'], { inVoice: true }),
      cand(2, ['Ysolde'], { inVoice: true, steamId: '76561190000000999' }),
    ]);
    expect(pick).toBe(1);
  });

  it('returns null with no candidates or no signal', () => {
    expect(pickClaimCandidate(subject('Morrow'), [])).toBeNull();
    expect(
      pickClaimCandidate(subject('Morrow'), [cand(1, ['Ysolde'])]),
    ).toBeNull();
  });
});
