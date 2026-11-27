/**
 * ROK-2362 #10 — golden strings: moving the Valheim welcome copy out of core
 * must not change a byte of what the hub welcome embed says.
 */
import { VALHEIM_HUB_WELCOME_COPY } from './valheim-hub-welcome.copy';

describe('VALHEIM_HUB_WELCOME_COPY', () => {
  it('describes the hub with the exact pre-move wording', () => {
    expect(VALHEIM_HUB_WELCOME_COPY.description('Ashlands')).toBe(
      "This channel is linked to the **Ashlands** hub: who's online, the map, chests, the crafting planner and the play schedule, all in one place.",
    );
  });

  it('keeps the exact pre-move claim hint', () => {
    expect(VALHEIM_HUB_WELCOME_COPY.claimHint).toBe(
      "Link Steam once on Raid Ledger and every character you play here is claimed for you. Or open the hub's Characters tab and pick yours.",
    );
  });

  it('escapes a link and mention in the hub name (ROK-1950 review)', () => {
    const text = VALHEIM_HUB_WELCOME_COPY.description(
      '[Login](https://evil.example) @everyone',
    );
    expect(text).toContain(
      '**\\[Login](https://evil.example) @​everyone**',
    );
    expect(text).not.toMatch(/(?<!\\)\[Login\]\(/);
  });
});
