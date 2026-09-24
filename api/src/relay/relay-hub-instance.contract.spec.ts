/**
 * ROK-1667 (RH-1a) — relay hub v1 wire shapes: envelope + instance schemas.
 *
 * Every import goes through `@raid-ledger/contract` (jest maps it to
 * `packages/contract/src/index.ts`), so each assertion here also proves the
 * barrel export (AC1). The bodies below are the ones today's CLIENT sends
 * (`api/src/relay/relay.service.ts:187` register, `:264` heartbeat); this
 * spec pins that the hub contract accepts them unchanged.
 */
import * as contract from '@raid-ledger/contract';
import {
  HUB_SCHEMA_VERSION,
  HubErrorSchema,
  HubHeartbeatRequestSchema,
  HubRegisterRequestSchema,
} from '@raid-ledger/contract';

/** Every §3.3 runtime name (AC1). */
const RELAY_HUB_EXPORTS = [
  'HUB_SCHEMA_VERSION',
  'RlGameIdSchema',
  'HubCursorSchema',
  'HubErrorCodeSchema',
  'HubErrorSchema',
  'HubTrustTierSchema',
  'HubRegisterRequestSchema',
  'HubRegisterResponseSchema',
  'HubHeartbeatRequestSchema',
  'HubHeartbeatResponseSchema',
  'CrosswalkKindSchema',
  'CrosswalkIdProvenanceSchema',
  'CrosswalkContributionItemSchema',
  'CrosswalkContributionBatchSchema',
  'CrosswalkContributionResultSchema',
] as const;

/** Compile-time half of AC1: `tsc` fails if a `z.infer` type is missing. */
type RelayHubInferredTypes = [
  contract.RlGameId,
  contract.HubCursor,
  contract.HubErrorCode,
  contract.HubError,
  contract.HubTrustTier,
  contract.HubRegisterRequest,
  contract.HubRegisterResponse,
  contract.HubHeartbeatRequest,
  contract.HubHeartbeatResponse,
  contract.CrosswalkKind,
  contract.CrosswalkIdProvenance,
  contract.CrosswalkContributionItem,
  contract.CrosswalkContributionBatch,
  contract.CrosswalkContributionResult,
];

/** RFC 9562 v4 uuid (version nibble 4, variant nibble 9). */
const INSTANCE_ID = '3f2b8c1e-7d4a-4b9e-9c21-5a6f0e8d1b37';
/** The stats today's client spreads into both bodies (`gatherStats`). */
const TODAY_STATS = {
  playerCount: 12,
  eventCount: 34,
  activeGames: 5,
  uptimeSeconds: 3600,
};

describe('relay hub contract — barrel (AC1)', () => {
  it.each(RELAY_HUB_EXPORTS)('exports %s from @raid-ledger/contract', (name) => {
    expect(Object.keys(contract)).toContain(name);
  });

  it('exports a z.infer type for each of the 14 schemas (checked by tsc)', () => {
    const typeCount: RelayHubInferredTypes['length'] = 14;
    expect(typeCount).toBe(RELAY_HUB_EXPORTS.length - 1);
  });

  it('pins HUB_SCHEMA_VERSION to 1', () => {
    expect(HUB_SCHEMA_VERSION).toBe(1);
  });

  it('does not add the M2 CrosswalkEntrySchema or HubPageSchema', () => {
    expect(Object.keys(contract)).not.toContain('CrosswalkEntrySchema');
    expect(Object.keys(contract)).not.toContain('HubPageSchema');
  });
});

describe('HubRegisterRequestSchema (AC2)', () => {
  it("parses today's register body to {instanceId, version, schemaVersion: 1} with the stats dropped", () => {
    const body = { instanceId: INSTANCE_ID, version: '0.0.1', ...TODAY_STATS };

    const result = HubRegisterRequestSchema.safeParse(body);

    expect(result).toEqual({
      success: true,
      data: { instanceId: INSTANCE_ID, version: '0.0.1', schemaVersion: 1 },
    });
    expect(Object.keys(result.data ?? {}).sort()).toEqual([
      'instanceId',
      'schemaVersion',
      'version',
    ]);
  });

  it('keeps enrollmentCode optional and carries it when sent (D1)', () => {
    const enrollmentCode = 'rlhe_0123456789abcdef';
    const body = { instanceId: INSTANCE_ID, version: '0.0.1', enrollmentCode };

    expect(HubRegisterRequestSchema.safeParse(body)).toEqual({
      success: true,
      data: { ...body, schemaVersion: 1 },
    });
  });
});

describe('HubHeartbeatRequestSchema (AC2 companion)', () => {
  it("parses today's heartbeat body to {version, schemaVersion: 1} with the stats dropped", () => {
    const result = HubHeartbeatRequestSchema.safeParse({
      version: '0.0.1',
      ...TODAY_STATS,
    });

    expect(result).toEqual({
      success: true,
      data: { version: '0.0.1', schemaVersion: 1 },
    });
    expect(Object.keys(result.data ?? {}).sort()).toEqual([
      'schemaVersion',
      'version',
    ]);
  });
});

describe('HubErrorSchema (AC4)', () => {
  it("degrades an unknown error code such as 'teapot' to 'unknown'", () => {
    expect(HubErrorSchema.safeParse({ error: 'teapot' })).toEqual({
      success: true,
      data: { error: 'unknown' },
    });
  });

  it('keeps a known error code and its message', () => {
    const body = { error: 'enrollment_required', message: 'code needed' };

    expect(HubErrorSchema.safeParse(body)).toEqual({
      success: true,
      data: body,
    });
  });
});
