import {
  VALHEIM_CLAIM_BUTTON_IDS,
  buildClaimHubUrl,
  buildClaimSuggestText,
  claimSuggestKeys,
} from './valheim-claim-suggest.copy';

const base = { characterName: 'Brindlemoss', hubName: 'fernhollow' };

describe('buildClaimSuggestText', () => {
  it('titles the DM with the character name', () => {
    const t = buildClaimSuggestText({ ...base, nameMatched: true, inVoice: false });
    expect(t.title).toBe('Is Brindlemoss yours?');
  });

  it('uses the name reason when only the name matched', () => {
    const t = buildClaimSuggestText({ ...base, nameMatched: true, inVoice: false });
    expect(t.message).toContain(
      'Brindlemoss is playing on fernhollow right now, and the name looks like yours.',
    );
  });

  it('uses the voice reason, naming the hub, when only voice matched', () => {
    const t = buildClaimSuggestText({ ...base, nameMatched: false, inVoice: true });
    expect(t.message).toContain("right now, while you're in the fernhollow voice channel.");
  });

  it('uses the combined reason when both matched', () => {
    const t = buildClaimSuggestText({ ...base, nameMatched: true, inVoice: true });
    expect(t.message).toContain("while you're in voice, and the name looks like yours.");
  });

  it('carries the Steam tip', () => {
    const t = buildClaimSuggestText({ ...base, nameMatched: true, inVoice: false });
    expect(t.message).toContain('Tip: link Steam once');
  });
});

describe('claim-suggest keys and ids', () => {
  it('names the four dedupe keys as the spec does', () => {
    expect(claimSuggestKeys.pair(7, 3)).toBe('valheim-claim-suggest:7:3');
    expect(claimSuggestKeys.user(3)).toBe('valheim-claim-suggest-user:3');
    expect(claimSuggestKeys.profile(7)).toBe('valheim-claim-suggest-profile:7');
    expect(claimSuggestKeys.declined(7, 3)).toBe('valheim-claim-suggest-declined:7:3');
  });

  it('uses the vclaim button prefixes', () => {
    expect(VALHEIM_CLAIM_BUTTON_IDS).toEqual({ YES: 'vclaim:yes', NO: 'vclaim:no' });
  });

  it('links the hub Characters tab', () => {
    expect(buildClaimHubUrl('https://rl.test', 12)).toBe('https://rl.test/hubs/12#characters');
  });
});
