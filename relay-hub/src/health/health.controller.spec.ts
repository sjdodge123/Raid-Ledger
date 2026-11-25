import {
  HUB_SCHEMA_VERSION,
  HubHealthResponseSchema,
} from '@raid-ledger/contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HealthController } from './health.controller';

const FIXTURE_PATH = join(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1/health.response.json',
);
const fixture = HubHealthResponseSchema.parse(
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')),
);

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns a body that parses with HubHealthResponseSchema', () => {
    const body = controller.health();
    expect(HubHealthResponseSchema.parse(body)).toEqual(body);
  });

  it('equals the golden fixture minus epoch (RH-2b adds it)', () => {
    expect(controller.health()).toEqual({
      status: fixture.status,
      schemaVersions: fixture.schemaVersions,
    });
    expect(controller.health()).not.toHaveProperty('epoch');
  });

  it('builds schemaVersions from HUB_SCHEMA_VERSION', () => {
    expect(controller.health().schemaVersions).toEqual([HUB_SCHEMA_VERSION]);
  });

  it('answers the live probe with {status: ok}', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });
});
