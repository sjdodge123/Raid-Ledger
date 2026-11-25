import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import postgres from 'postgres';
import type { App } from 'supertest/types';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import { must, testItem } from '../test/crosswalk-test-kit';
import {
  approvedInstance,
  bootHubApp,
  cli,
  contribute,
  fixture,
  postContributions,
} from '../test/hub-app-kit';
import { createTestDatabase, type TestDatabase } from '../test/test-database';

const DRG_ITAD = '018f4a2c-7b3e-7c91-9d2a-5e6f7a8b9c0d';
const INSTANCE = '6d6d6d6d-6666-4666-8666-666666666666';

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let app: INestApplication<App>;
let token: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  app = await bootHubApp(db.url);
  token = await approvedInstance(app, db.url, INSTANCE);
  const res = await postContributions(
    app,
    token,
    fixture('contributions.request.json'),
  );
  expect(res.status).toBe(200);
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

it('AC5: lookup steam_app_id 570 prints one game and each id with its provenance', async () => {
  const { code, out } = await cli(
    db.url,
    'lookup',
    '--kind',
    'steam_app_id',
    '--value',
    '570',
  );
  expect(code).toBe(0);
  expect(out[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26} {2}Dota 2 \(match-only\)$/);
  expect(
    out.some((l) => /^\s+steam_app_id\s+570\s+instance\s+steam$/.test(l)),
  ).toBe(true);
  expect(out.some((l) => /^\s+igdb_id\s+2963\s+instance\s+igdb$/.test(l))).toBe(
    true,
  );
});

it('AC5: an upper-case ITAD UUID is normalised; an unknown value exits 1; a bogus kind exits 2', async () => {
  const itad = await cli(
    db.url,
    'lookup',
    '--kind',
    'itad_uuid',
    '--value',
    DRG_ITAD.toUpperCase(),
  );
  expect(itad.code).toBe(0);
  expect(itad.out[0]).toContain('Deep Rock Galactic (match-only)');
  expect(
    (
      await cli(
        db.url,
        'lookup',
        '--kind',
        'steam_app_id',
        '--value',
        '999999999',
      )
    ).code,
  ).toBe(1);
  expect(
    (await cli(db.url, 'lookup', '--kind', 'bogus', '--value', '570')).code,
  ).toBe(2);
});

it('AC6: conflicts lists the RH-4a AC 4 conflict, labelled resolved-to/owner; --json is deterministic', async () => {
  const empty = await cli(db.url, 'conflicts');
  expect(empty.out).toEqual(['No open conflicts.']);
  const steam = 9_100_001;
  const itad = randomUUID();
  const [a] = await contribute(app, token, [
    testItem('Conflict Alpha', { steam }),
  ]);
  const [b] = await contribute(app, token, [
    testItem('Conflict Beta', { itad }),
  ]);
  const [split] = await contribute(app, token, [
    testItem('Conflict Split', { steam, itad }),
  ]);
  expect(must(split, 'split').result).toBe('conflict');
  const aId = must(must(a, 'a').rlGameId, 'a id');
  const bId = must(must(b, 'b').rlGameId, 'b id');

  const text = await cli(db.url, 'conflicts');
  expect(text.code).toBe(0);
  expect(text.out[0]).toMatch(
    /^id\s+kind\s+value\s+resolved-to\s+owner\s+instance\s+created$/,
  );
  expect(text.out).toHaveLength(2);
  expect(text.out[1]).toMatch(
    new RegExp(`itad_uuid\\s+${itad}\\s+${aId}\\s+${bId}\\s+${INSTANCE}`),
  );

  const first = await cli(db.url, 'conflicts', '--json');
  const second = await cli(db.url, 'conflicts', '--json');
  expect(first.out).toEqual(second.out);
  const parsed: unknown = JSON.parse(first.out.join('\n'));
  expect(parsed).toEqual([
    expect.objectContaining({
      kind: 'itad_uuid',
      value: itad,
      resolvedTo: aId,
      owner: bId,
      instanceId: INSTANCE,
      resolvedAt: null,
    }),
  ]);
  expect((await cli(db.url, 'conflicts', '--all', '--json')).out).toEqual(
    first.out,
  );
});

it('AC6: same-instant conflicts tie-break by numeric id, so 10 sorts before 9', async () => {
  const sql = postgres(db.url, { max: 1, onnotice: () => undefined });
  try {
    for (const id of [9, 10]) {
      await sql`
        INSERT INTO hub_crosswalk_conflicts
          (id, kind, value, existing_rl_game_id, instance_id, payload, created_at)
        VALUES (${id}, 'steam_app_id', ${`tie-${id}`}, 'tie-game', ${INSTANCE},
                '{}'::jsonb, '2099-01-01T00:00:00Z')`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  const { code, out } = await cli(db.url, 'conflicts', '--json');
  expect(code).toBe(0);
  const parsed: unknown = JSON.parse(out.join('\n'));
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  const ids: unknown[] = parsed.map((v: { id?: unknown }) => v.id);
  expect(ids.slice(0, 2)).toEqual(['10', '9']);
});
