/**
 * ROK-2107: a sync writes Blizzard professions to `armoryProfessions` only —
 * the user-entered `professions` column is never in a sync record.
 */
import {
  applyOptionalSyncFields,
  buildSyncUpdateFields,
  type EnrichedProfile,
} from './characters-sync.helpers';

const PAYLOAD = {
  primary: [],
  secondary: [],
  syncedAt: '2026-11-06T00:00:00.000Z',
};

const PROFILE: EnrichedProfile['profile'] = {
  name: 'Ana',
  realm: null,
  class: 'Mage',
  spec: null,
  role: null,
  level: 25,
  race: 'Gnome',
  faction: 'alliance',
  itemLevel: null,
  avatarUrl: null,
  renderUrl: null,
  profileUrl: null,
};

describe('applyOptionalSyncFields (ROK-2107)', () => {
  it('puts a Blizzard professions payload in armoryProfessions, never professions', () => {
    const record = applyOptionalSyncFields(
      { name: 'x' },
      { professions: PAYLOAD, equipment: null, talents: null },
    );
    expect(record).toHaveProperty('armoryProfessions', PAYLOAD);
    expect(record).not.toHaveProperty('professions');
  });

  it('emits neither key when the adapter returned null (leave prior value)', () => {
    const record = applyOptionalSyncFields(
      {},
      { professions: null, equipment: null, talents: null },
    );
    expect(record).not.toHaveProperty('armoryProfessions');
    expect(record).not.toHaveProperty('professions');
  });
});

describe('buildSyncUpdateFields (ROK-2107)', () => {
  it('routes professions to armoryProfessions for every caller', () => {
    const fields = buildSyncUpdateFields(PROFILE, null, null, PAYLOAD);
    expect(fields).toHaveProperty('armoryProfessions', PAYLOAD);
    expect(fields).not.toHaveProperty('professions');
  });
});
