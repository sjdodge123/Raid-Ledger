import { sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { AddonImportTx } from './addon-import-apply.types';
import { GUID_AUDIT_ENTITY, logGuidAudit } from './addon-import.guid-audit';
import {
  EXTERNAL_ID_LINKED_ACTION,
  isExternalIdLinkChange,
  logExternalIdLinked,
  type ExternalIdLinkEntry,
} from './external-id.audit';

/** A tx whose `insert(table).values(v)` records the call. */
function recordingTx() {
  const values = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values });
  const tx = { insert } as unknown as AddonImportTx;
  return { tx, insert, values };
}

const entry: ExternalIdLinkEntry = {
  actorId: 7,
  ownerId: 7,
  characterId: 'char-1',
  externalId: '123456',
  gameId: 3,
  region: 'us',
  via: 'armory_import',
};

describe('isExternalIdLinkChange (ROK-2115 Ruling 5)', () => {
  it.each([
    ['123', null, true],
    ['123', undefined, true],
    ['123', '999', true],
    ['123', '123', false],
    [null, null, false],
    [undefined, '123', false],
    ['', null, false],
  ])('next %p previous %p → %p', (next, previous, expected) => {
    expect(isExternalIdLinkChange(next, previous)).toBe(expected);
  });
});

describe('logExternalIdLinked (ROK-2115 Ruling 5)', () => {
  it('writes external_id_linked under the GUID audit entity when the id is newly set', async () => {
    const { tx, insert, values } = recordingTx();
    const wrote = await logExternalIdLinked(tx, entry, null);
    expect(wrote).toBe(true);
    expect(insert).toHaveBeenCalledWith(schema.activityLog);
    expect(values).toHaveBeenCalledWith({
      entityType: GUID_AUDIT_ENTITY,
      entityId: 7,
      action: EXTERNAL_ID_LINKED_ACTION,
      actorId: 7,
      metadata: {
        characterId: 'char-1',
        externalId: '123456',
        gameId: 3,
        region: 'us',
        via: 'armory_import',
        ownerId: 7,
      },
    });
  });

  it('writes when the id changes to a different Blizzard character', async () => {
    const { tx, values } = recordingTx();
    expect(await logExternalIdLinked(tx, entry, '999')).toBe(true);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when a re-import keeps the same id (no-op)', async () => {
    const { tx, insert } = recordingTx();
    expect(await logExternalIdLinked(tx, entry, '123456')).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('writes nothing when the character carries no id', async () => {
    const { tx, insert } = recordingTx();
    const none = { ...entry, externalId: null };
    expect(await logExternalIdLinked(tx, none, null)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('records a null actor for the background auto-link job', async () => {
    const { tx, values } = recordingTx();
    const job = { ...entry, actorId: null, via: 'auto_link' as const };
    await logExternalIdLinked(tx, job, null);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null }),
    );
  });
});

describe('audit created_at override (ROK-2160 review r2 M4)', () => {
  const at = sql`clock_timestamp()`;

  it('logExternalIdLinked writes createdAt as a column, not metadata', async () => {
    const { tx, values } = recordingTx();
    await logExternalIdLinked(tx, { ...entry, createdAt: at }, null);
    const row: unknown = values.mock.calls[0]?.[0];
    expect(row).toEqual(expect.objectContaining({ createdAt: at }));
    expect(row).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ createdAt: expect.anything() }),
      }),
    );
  });

  it('logExternalIdLinked leaves createdAt to the column default when unset', async () => {
    const { tx, values } = recordingTx();
    await logExternalIdLinked(tx, entry, null);
    expect(values.mock.calls[0]?.[0]).not.toHaveProperty('createdAt');
  });

  it('logGuidAudit writes createdAt as a column', async () => {
    const { tx, values } = recordingTx();
    await logGuidAudit(tx, {
      action: 'addon_guid_claimed',
      actorId: null,
      ownerId: 7,
      characterId: 'char-1',
      guid: 'Player-1-2',
      name: 'Bob',
      gameId: 3,
      region: 'us',
      via: 'owner_reactivated',
      createdAt: at,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: at }),
    );
  });
});
