/**
 * ROK-1953 M1–M4 — per-viewer masking of hidden achievements. A masked entry
 * carries ONLY its global % (never the api name, name or description).
 */
import { maskAchievement, type StoredAchievement } from './steam-stats.mask';

const hidden: StoredAchievement = {
  apiName: 'ACH_SECRET_ENDING',
  name: 'The Secret Ending',
  description: 'Spoiler text',
  hidden: true,
  globalPct: '3.250',
};
const visible: StoredAchievement = {
  ...hidden,
  apiName: 'ACH_ACT_ONE',
  name: 'Act One',
  hidden: false,
  globalPct: '61.000',
};

describe('maskAchievement (M1–M4)', () => {
  it('M1 — hidden + not unlocked by the viewer: keys are exactly masked + globalPct', () => {
    const view = maskAchievement(hidden, new Set(['ACH_ACT_ONE']));
    expect(Object.keys(view).sort()).toEqual(['globalPct', 'masked']);
    expect(view).toEqual({ masked: true, globalPct: 3.25 });
    expect(JSON.stringify(view)).not.toMatch(/SECRET|Secret|Spoiler/);
  });

  it('M2 — hidden + unlocked by the viewer: the full entry', () => {
    expect(maskAchievement(hidden, new Set(['ACH_SECRET_ENDING']))).toEqual({
      masked: false,
      apiName: 'ACH_SECRET_ENDING',
      name: 'The Secret Ending',
      description: 'Spoiler text',
      hidden: true,
      globalPct: 3.25,
    });
  });

  it('M3 — not hidden: full even when the viewer has not unlocked it', () => {
    expect(maskAchievement(visible, new Set())).toMatchObject({
      masked: false,
      name: 'Act One',
      globalPct: 61,
    });
  });

  it('M4 — an empty unlocked set masks every hidden achievement', () => {
    const view = maskAchievement({ ...hidden, globalPct: null }, new Set());
    expect(view).toEqual({ masked: true, globalPct: null });
  });

  it('clamps a stored % outside 0–100 and drops an unparsable one', () => {
    expect(
      maskAchievement({ ...visible, globalPct: '100.400' }, new Set()),
    ).toMatchObject({ globalPct: 100 });
    expect(maskAchievement({ ...hidden, globalPct: 'NaN' }, new Set())).toEqual(
      { masked: true, globalPct: null },
    );
  });
});
