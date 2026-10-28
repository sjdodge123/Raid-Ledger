/**
 * ROK-1956 §8 — `CompanionConfigService.build`: what `/config` answers per
 * caller. Pure: the registry gets a fake plugin-activity reader.
 */
import {
  BG3_SAVE_CONTRACT_ID,
  WOW_LEDGERLINK_CONTRACT_ID,
  Bg3SaveMessageSchema,
  COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
  COMPANION_IMAGE_EDGE_MAX,
  COMPANION_MESSAGE_MAX_BYTES,
  COMPANION_WEBP_MAX_BYTES,
  CompanionConfigSchema,
  type CompanionContractTable,
} from '@raid-ledger/contract';
import {
  CompanionHandlerRegistry,
  type CompanionContractHandler,
} from '../ingest/companion-handler.registry';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import {
  CompanionConfigService,
  DEFAULT_COMPANION_MIN_APP_VERSION,
} from './companion-config.service';

const OWNER = 'test-owner';
const DEVICE: CompanionIngestAuth = {
  userId: 7,
  via: 'device',
  deviceId: 3,
  tokenHash: 'h',
};
const SESSION: CompanionIngestAuth = {
  userId: 7,
  via: 'session',
  deviceId: null,
  tokenHash: null,
};

const TABLE: CompanionContractTable = {
  [BG3_SAVE_CONTRACT_ID]: {
    1: {
      schema: Bg3SaveMessageSchema,
      maxBytes: 1000,
      blobSlots: ['thumbnail'],
      status: 'accepted',
    },
    2: {
      schema: Bg3SaveMessageSchema,
      maxBytes: 2000,
      blobSlots: [],
      status: 'current',
    },
  },
};

const handler = (
  over: Partial<CompanionContractHandler> = {},
): CompanionContractHandler => ({
  contract: BG3_SAVE_CONTRACT_ID,
  versions: [1, 2],
  handle: () => Promise.resolve(),
  ...over,
});

let active = true;
let registry: CompanionHandlerRegistry;
let service: CompanionConfigService;

beforeEach(() => {
  active = true;
  delete process.env.COMPANION_MIN_APP_VERSION;
  registry = new CompanionHandlerRegistry({ isActive: () => active }, TABLE);
  service = new CompanionConfigService(registry, TABLE);
});

afterAll(() => {
  delete process.env.COMPANION_MIN_APP_VERSION;
});

describe('anonymous', () => {
  it('answers configVersion + minAppVersion + the global limits only', () => {
    const out = service.build(null);
    expect(out).toEqual({
      configVersion: 1,
      minAppVersion: DEFAULT_COMPANION_MIN_APP_VERSION,
      limits: {
        messageMaxBytes: COMPANION_MESSAGE_MAX_BYTES,
        webpMaxBytes: COMPANION_WEBP_MAX_BYTES,
        imageEdgeMax: COMPANION_IMAGE_EDGE_MAX,
        capturedAtMaxFutureMs: COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
      },
    });
    expect(CompanionConfigSchema.safeParse(out).success).toBe(true);
  });

  it('minAppVersion comes from COMPANION_MIN_APP_VERSION when it is a valid version', () => {
    process.env.COMPANION_MIN_APP_VERSION = '1.4.0-beta.2';
    expect(service.build(null).minAppVersion).toBe('1.4.0-beta.2');
  });

  it('an invalid COMPANION_MIN_APP_VERSION falls back to the default (never a 500)', () => {
    process.env.COMPANION_MIN_APP_VERSION = 'latest';
    expect(service.build(null).minAppVersion).toBe(
      DEFAULT_COMPANION_MIN_APP_VERSION,
    );
  });
});

describe('authenticated', () => {
  it('a device caller gets rate + every table contract, enabled when it resolves', () => {
    registry.register(OWNER, handler({ cadence: { minIntervalSec: 300 } }));
    const out = service.build(DEVICE);
    expect(out.rate).toEqual({
      messagesPerMin: expect.anything() as unknown,
      blobsPerMin: expect.anything() as unknown,
    });
    expect(out.contracts).toEqual([
      {
        id: BG3_SAVE_CONTRACT_ID,
        enabled: true,
        versions: [
          { version: 1, status: 'accepted' },
          { version: 2, status: 'current' },
        ],
        maxBytes: 2000,
        blobSlots: [],
        cadence: { minIntervalSec: 300 },
      },
    ]);
  });

  it('no handler → enabled false with the default 120 s cadence', () => {
    const contract = service.build(DEVICE).contracts?.[0];
    expect(contract).toMatchObject({
      enabled: false,
      cadence: { minIntervalSec: 120 },
    });
  });

  it('owner plugin off → enabled false', () => {
    registry.register(OWNER, handler());
    active = false;
    expect(service.build(DEVICE).contracts?.[0]?.enabled).toBe(false);
  });

  it('a session caller sees a device-only handler as disabled, an opted-in one as enabled', () => {
    registry.register(OWNER, handler());
    expect(service.build(SESSION).contracts?.[0]?.enabled).toBe(false);
    const other = new CompanionHandlerRegistry({ isActive: () => true }, TABLE);
    other.register(OWNER, handler({ sources: ['device', 'session'] }));
    const out = new CompanionConfigService(other, TABLE).build(SESSION);
    expect(out.contracts?.[0]?.enabled).toBe(true);
  });

  it('rate reflects the env caps (device = tightest of device and user)', () => {
    process.env.COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN = '5';
    process.env.COMPANION_INGEST_RATE_MESSAGES_PER_USER_PER_MIN = '9';
    try {
      expect(service.build(DEVICE).rate?.messagesPerMin).toBe(5);
      expect(service.build(SESSION).rate?.messagesPerMin).toBe(9);
    } finally {
      delete process.env.COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN;
      delete process.env.COMPANION_INGEST_RATE_MESSAGES_PER_USER_PER_MIN;
    }
  });

  it('defaults to the shipped table: bg3-save and wow-ledgerlink are listed', () => {
    const shipped = new CompanionConfigService(registry);
    const ids = shipped.build(DEVICE).contracts?.map((c) => c.id);
    expect(ids).toEqual([BG3_SAVE_CONTRACT_ID, WOW_LEDGERLINK_CONTRACT_ID]);
  });
});
