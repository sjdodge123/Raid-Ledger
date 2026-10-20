/**
 * ROK-1853 L2 — pure parts of the containers importer: the D7 public key and
 * the row mappers (fixtures from packages/contract/valheim-link/v1).
 */
import { createHash } from 'node:crypto';
import {
  ValheimContainersMessageSchema,
  type ValheimContainersMessage,
} from '@raid-ledger/contract';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { chunked } from './valheim-containers.repository';
import {
  containerPublicKey,
  toContainerRows,
  toScanValues,
  toStackRows,
} from './valheim-armory-containers.import';
import type { ArmorySnapshot } from './valheim-armory.mappers';

const fixture = (name: string): ValheimContainersMessage =>
  ValheimContainersMessageSchema.parse(loadValheimFixture(name));

const snap: ArmorySnapshot = {
  id: 77,
  pelicanServerId: 5,
  kind: 'containers',
  steamId: null,
  playerId: null,
  worldUid: '1234567890123',
  receivedAt: '2026-10-17 20:15:00+00',
  payload: null,
};

const chest = {
  prefab: 'piece_chest',
  x: 3,
  y: 32.5,
  z: 51.5,
  creatorPlayerId: '1000000000000001',
};

describe('containerPublicKey (D7)', () => {
  it('is 22 base64url characters', () => {
    expect(containerPublicKey('1234567890123', chest)).toMatch(
      /^[A-Za-z0-9_-]{22}$/,
    );
  });

  it('is stable across re-imports of the same chest', () => {
    expect(containerPublicKey('1234567890123', { ...chest })).toBe(
      containerPublicKey('1234567890123', chest),
    );
  });

  it('differs for two creators at one spot, and per world', () => {
    const base = containerPublicKey('1234567890123', chest);
    const other = containerPublicKey('1234567890123', {
      ...chest,
      creatorPlayerId: '1000000000000002',
    });
    expect(other).not.toBe(base);
    expect(containerPublicKey('999', chest)).not.toBe(base);
  });

  it('hashes the documented identity string', () => {
    // sha256('1|a|1|2|3|9') first 16 bytes, base64url — pins the formula.
    const expected = createHash('sha256')
      .update('1|a|1|2|3|9')
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    expect(
      containerPublicKey('1', {
        prefab: 'a',
        x: 1,
        y: 2,
        z: 3,
        creatorPlayerId: '9',
      }),
    ).toBe(expected);
  });
});

describe('toScanValues', () => {
  it('maps the header, omitted counts and stored totals', () => {
    const msg = fixture('containers-private');
    expect(toScanValues(snap, msg)).toEqual({
      pelicanServerId: 5,
      worldUid: '1234567890123',
      gameVersion: '0.220.5',
      capturedAt: new Date('2026-10-17T20:15:00Z'),
      omittedShared: 1,
      omittedPrivate: 1,
      containerCount: 3,
      stackCount: 2,
      sourceSnapshotId: 77,
    });
  });
});

describe('toContainerRows', () => {
  it('maps every container, keeps privacy as sent and keys by D7', () => {
    const msg = fixture('containers-basic');
    const rows = toContainerRows(msg, 9, 5);
    expect(rows).toHaveLength(msg.containers.length);
    expect(rows[1]).toEqual({
      scanId: 9,
      pelicanServerId: 5,
      publicKey: containerPublicKey(msg.worldUid, chest),
      prefab: 'piece_chest',
      x: 3,
      y: 32.5,
      z: 51.5,
      creatorPlayerId: '1000000000000001',
      privacy: 'public',
      vehicle: false,
      slots: expect.any(Number) as number,
      usedSlots: expect.any(Number) as number,
      unreadable: false,
      omittedEntries: 0,
    });
    expect(new Set(rows.map((r) => r.publicKey)).size).toBe(rows.length);
  });

  it('stores group privacy as group (nothing derived)', () => {
    const msg = fixture('containers-basic');
    const first = msg.containers[0];
    if (!first) throw new Error('fixture has no containers');
    const grouped = {
      ...msg,
      containers: [{ ...first, privacy: 'group' as const }],
    };
    expect(toContainerRows(grouped, 1, 1)[0]?.privacy).toBe('group');
  });
});

describe('toStackRows', () => {
  it('joins stacks to their container ids by public key', () => {
    const msg = fixture('containers-basic');
    const inserted = toContainerRows(msg, 1, 1).map((r, i) => ({
      id: 100 + i,
      publicKey: r.publicKey,
    }));
    const stacks = toStackRows(msg, inserted);
    const expected = msg.containers.flatMap((c, i) =>
      c.items.map((s) => ({ containerId: 100 + i, ...s })),
    );
    expect(stacks).toEqual(expected);
  });

  it('throws when a container has no inserted row', () => {
    expect(() => toStackRows(fixture('containers-basic'), [])).toThrow(
      /no row for key/,
    );
  });
});

describe('chunked', () => {
  it('splits into chunks of at most size, none for empty input', () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 3)).toEqual([]);
  });
});
