/**
 * ROK-1667 (RH-1a) AC5 — the relay hub v1 golden fixtures.
 *
 * Walks `packages/contract/src/relay/__fixtures__/v1/`, parses every file
 * with its mapped schema, and fails on any `*.json` fixture nobody mapped.
 * Response fixtures are re-parsed with an extra unknown key on every
 * object: changes within v1 are additive only (relay-hub scope §3.1), so a
 * reader built at v1 must tolerate a later v1 hub's new fields. The client
 * request fixtures are the bodies RH-5's smoke curls at a real hub; they
 * are read with readFileSync so the contract needs no resolveJsonModule.
 */
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  CrosswalkContributionBatchSchema,
  CrosswalkContributionResponseSchema,
  HubErrorSchema,
  HubHealthResponseSchema,
  HubHeartbeatRequestSchema,
  HubHeartbeatResponseSchema,
  HubRegisterRequestSchema,
  HubRegisterResponseSchema,
} from '@raid-ledger/contract';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1',
);

/** Structural view of a zod schema: enough to parse and report issues. */
interface FixtureSchema {
  safeParse(data: unknown): {
    success: boolean;
    error?: { issues: unknown[] };
  };
}

const FIXTURE_SCHEMAS: Record<string, FixtureSchema> = {
  'health.response.json': HubHealthResponseSchema,
  'register.request.client.json': HubRegisterRequestSchema,
  'register.response.json': HubRegisterResponseSchema,
  'heartbeat.request.client.json': HubHeartbeatRequestSchema,
  'heartbeat.response.json': HubHeartbeatResponseSchema,
  'contributions.request.json': CrosswalkContributionBatchSchema,
  'contributions.response.json': CrosswalkContributionResponseSchema,
  'error.response.json': HubErrorSchema,
};

/** Every v1 M1 response (§3.2) needs a golden fixture (AC5). */
const M1_RESPONSES = [
  'health',
  'register',
  'heartbeat',
  'contributions',
  'error',
];

const RESPONSE_FIXTURES = Object.keys(FIXTURE_SCHEMAS).filter((f) =>
  f.endsWith('.response.json'),
);

const EXTRA_KEY = 'addedLaterInV1';

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

/** The parse's issues, `[]` on success, so a failure names the bad path. */
function parseIssues(schema: FixtureSchema, data: unknown): unknown[] {
  const result = schema.safeParse(data);
  return result.success ? [] : (result.error?.issues ?? []);
}

/** Deep copy with {@link EXTRA_KEY} added to every plain object. */
function withExtraKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withExtraKeys);
  if (value === null || typeof value !== 'object') return value;
  const copy = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, withExtraKeys(v)]),
  );
  return { ...copy, [EXTRA_KEY]: 'a field this reader predates' };
}

describe('relay hub v1 golden fixtures (AC5)', () => {
  it('maps every *.json fixture in the directory to a schema', () => {
    const unmapped = fixtureFiles().filter((f) => !(f in FIXTURE_SCHEMAS));
    expect(unmapped).toEqual([]);
  });

  it('has a fixture for every mapped name and every v1 M1 response', () => {
    const present = new Set(fixtureFiles());
    const wanted = new Set([
      ...Object.keys(FIXTURE_SCHEMAS),
      ...M1_RESPONSES.map((name) => `${name}.response.json`),
    ]);
    expect([...wanted].filter((f) => !present.has(f))).toEqual([]);
  });

  it.each(Object.keys(FIXTURE_SCHEMAS))('%s parses with its schema', (f) => {
    expect(parseIssues(FIXTURE_SCHEMAS[f], readFixture(f))).toEqual([]);
  });

  it.each(RESPONSE_FIXTURES)(
    '%s still parses with an unknown key on every object (§3.1)',
    (file) => {
      const fromLaterHub = withExtraKeys(readFixture(file));
      expect(parseIssues(FIXTURE_SCHEMAS[file], fromLaterHub)).toEqual([]);
    },
  );
});

describe('relay hub v1 client request fixtures (RH-5 smoke bodies)', () => {
  const STATS = ['activeGames', 'eventCount', 'playerCount', 'uptimeSeconds'];

  it("register body is today's exact client body; the hub drops the stats", () => {
    const body = readFixture('register.request.client.json') as object;
    expect(Object.keys(body).sort()).toEqual(
      [...STATS, 'instanceId', 'version'].sort(),
    );
    expect(Object.keys(HubRegisterRequestSchema.parse(body)).sort()).toEqual([
      'instanceId',
      'schemaVersion',
      'version',
    ]);
  });

  it("heartbeat body is today's exact client body; the hub drops the stats", () => {
    const body = readFixture('heartbeat.request.client.json') as object;
    expect(Object.keys(body).sort()).toEqual([...STATS, 'version'].sort());
    expect(HubHeartbeatRequestSchema.parse(body)).toEqual({
      version: '0.0.1',
      schemaVersion: 1,
    });
  });
});
