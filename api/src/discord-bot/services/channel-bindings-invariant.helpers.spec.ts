/**
 * channel-bindings-invariant.helpers.spec.ts — ROK-1415 (B3-1)
 *
 * TDD failing tests for the binding-triple invariant guard. Written BEFORE the
 * implementation exists, so they MUST fail-by-construction: the contract
 * exports (`classifyBindingTriple`, `deriveBindingPurpose`, `BindingTripleViolation`)
 * and this helpers module (`assertValidBindingTriple`, `detectBehavior`) are not
 * created yet.
 *
 * Coverage:
 *  1. Full 24-cell cross product channelType{2} × bindingPurpose{3} × gameId{4}
 *     asserting the EXACT `code` (or null) per D2(a)'s truth table. The
 *     `gameId === 0` VALID-for-monitor row is mandatory — it guards against
 *     replicating the `!binding.gameId` truthiness bug (voice-state.handlers.ts:211).
 *  2. `assertValidBindingTriple` throw shape `{code, field, errors[]}` + the
 *     `[binding-guard]` WARN (mocked logger).
 *  3. Anti-drift: `deriveBindingPurpose` NEVER produces a purpose that
 *     `classifyBindingTriple` rejects — asserted on every cell.
 */
import { Logger, BadRequestException } from '@nestjs/common';
import {
  classifyBindingTriple,
  deriveBindingPurpose,
  type BindingTripleViolation,
  type BindingPurpose,
  type ChannelType,
} from '@raid-ledger/contract';
import {
  assertValidBindingTriple,
  detectBehavior,
} from './channel-bindings-invariant.helpers';

type ViolationCode = BindingTripleViolation['code'];
type ViolationField = BindingTripleViolation['field'];

interface Cell {
  channelType: ChannelType;
  bindingPurpose: BindingPurpose;
  gameLabel: string;
  gameId: number | null | undefined;
  /** null = the triple is legal; otherwise the exact rejection code. */
  code: ViolationCode | null;
  field?: ViolationField;
}

/**
 * The FULL truth table, written out literally (24 rows) so it acts as an
 * independent oracle rather than re-deriving the logic under test. Grouped by
 * (channelType, bindingPurpose); the four gameId columns are null / undefined /
 * 0 / 42 in order.
 */
const TRUTH_TABLE: Cell[] = [
  // ── voice + game-voice-monitor: needs a game; 0 is a REAL game (mandatory) ──
  {
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: 'null',
    gameId: null,
    code: 'BINDING_MONITOR_REQUIRES_GAME',
    field: 'gameId',
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: 'undefined',
    gameId: undefined,
    code: 'BINDING_MONITOR_REQUIRES_GAME',
    field: 'gameId',
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: '0',
    gameId: 0,
    code: null,
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: '42',
    gameId: 42,
    code: null,
  },
  // ── voice + general-lobby: legal for any gameId (lobby resolves from presence) ──
  {
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameLabel: 'null',
    gameId: null,
    code: null,
  },
  {
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameLabel: 'undefined',
    gameId: undefined,
    code: null,
  },
  {
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameLabel: '0',
    gameId: 0,
    code: null,
  },
  {
    channelType: 'voice',
    bindingPurpose: 'general-lobby',
    gameLabel: '42',
    gameId: 42,
    code: null,
  },
  // ── voice + game-announcements: announcements are a TEXT purpose ──
  {
    channelType: 'voice',
    bindingPurpose: 'game-announcements',
    gameLabel: 'null',
    gameId: null,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-announcements',
    gameLabel: 'undefined',
    gameId: undefined,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-announcements',
    gameLabel: '0',
    gameId: 0,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'voice',
    bindingPurpose: 'game-announcements',
    gameLabel: '42',
    gameId: 42,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  // ── text + game-announcements: legal for any gameId ──
  {
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameLabel: 'null',
    gameId: null,
    code: null,
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameLabel: 'undefined',
    gameId: undefined,
    code: null,
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameLabel: '0',
    gameId: 0,
    code: null,
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameLabel: '42',
    gameId: 42,
    code: null,
  },
  // ── text + game-voice-monitor: voice purpose on a text channel ──
  {
    channelType: 'text',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: 'null',
    gameId: null,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: 'undefined',
    gameId: undefined,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: '0',
    gameId: 0,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'game-voice-monitor',
    gameLabel: '42',
    gameId: 42,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  // ── text + general-lobby: voice purpose on a text channel ──
  {
    channelType: 'text',
    bindingPurpose: 'general-lobby',
    gameLabel: 'null',
    gameId: null,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'general-lobby',
    gameLabel: 'undefined',
    gameId: undefined,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'general-lobby',
    gameLabel: '0',
    gameId: 0,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
  {
    channelType: 'text',
    bindingPurpose: 'general-lobby',
    gameLabel: '42',
    gameId: 42,
    code: 'BINDING_PURPOSE_WRONG_CHANNEL_TYPE',
    field: 'bindingPurpose',
  },
];

describe('classifyBindingTriple — full 24-cell cross product (ROK-1415)', () => {
  it('covers exactly 24 cells (2 channelTypes × 3 purposes × 4 gameIds)', () => {
    expect(TRUTH_TABLE).toHaveLength(24);
  });

  for (const cell of TRUTH_TABLE) {
    const label = `${cell.channelType} + ${cell.bindingPurpose} + gameId=${cell.gameLabel}`;
    if (cell.code === null) {
      it(`ALLOWS ${label}`, () => {
        expect(
          classifyBindingTriple(
            cell.channelType,
            cell.bindingPurpose,
            cell.gameId,
          ),
        ).toBeNull();
      });
    } else {
      it(`REJECTS ${label} → ${cell.code}`, () => {
        const violation = classifyBindingTriple(
          cell.channelType,
          cell.bindingPurpose,
          cell.gameId,
        );
        expect(violation).not.toBeNull();
        expect(violation?.code).toBe(cell.code);
        expect(violation?.field).toBe(cell.field);
        expect(typeof violation?.message).toBe('string');
        expect(violation?.message.length).toBeGreaterThan(0);
      });
    }
  }

  it('classifies gameId === 0 as a VALID game for a monitor (NOT truthiness)', () => {
    // The regression cell: `!gameId` would misfire here and disable Quick Play.
    expect(classifyBindingTriple('voice', 'game-voice-monitor', 0)).toBeNull();
  });
});

describe('assertValidBindingTriple — throw shape + [binding-guard] WARN (ROK-1415)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('throws BadRequestException with {message, code, field, errors[]} for a null-game monitor', () => {
    let caught: unknown;
    try {
      assertValidBindingTriple({
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: null,
        guildId: 'g-1',
        channelId: 'c-1',
        bindingId: 'b-1',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as {
      message: string;
      code: string;
      field: string;
      errors: string[];
    };
    expect(body.message).toBe('Invalid channel binding');
    expect(body.code).toBe('BINDING_MONITOR_REQUIRES_GAME');
    expect(body.field).toBe('gameId');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toContain('gameId');
  });

  it('throws BINDING_PURPOSE_WRONG_CHANNEL_TYPE for a voice purpose on a text channel', () => {
    expect(() =>
      assertValidBindingTriple({
        channelType: 'text',
        bindingPurpose: 'game-voice-monitor',
        gameId: 42,
      }),
    ).toThrow(BadRequestException);
  });

  it('emits a [binding-guard] WARN naming the rejection before throwing', () => {
    expect(() =>
      assertValidBindingTriple({
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: null,
        channelId: 'c-42',
      }),
    ).toThrow(BadRequestException);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[binding-guard]'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('BINDING_MONITOR_REQUIRES_GAME'),
    );
  });

  it('does NOT throw and does NOT warn for a valid monitor+game triple (incl. gameId 0)', () => {
    expect(() =>
      assertValidBindingTriple({
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: 0,
      }),
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('deriveBindingPurpose — canonical derivation + anti-drift (ROK-1415)', () => {
  it('voice + a game (incl. 0) → game-voice-monitor; voice + no game → general-lobby', () => {
    expect(deriveBindingPurpose('voice', 42)).toBe('game-voice-monitor');
    expect(deriveBindingPurpose('voice', 0)).toBe('game-voice-monitor'); // != null, not truthiness
    expect(deriveBindingPurpose('voice', null)).toBe('general-lobby');
    expect(deriveBindingPurpose('voice', undefined)).toBe('general-lobby');
  });

  it('text → game-announcements regardless of gameId', () => {
    expect(deriveBindingPurpose('text', null)).toBe('game-announcements');
    expect(deriveBindingPurpose('text', 42)).toBe('game-announcements');
    expect(deriveBindingPurpose('text', 0)).toBe('game-announcements');
  });

  it('NEVER produces a purpose that classifyBindingTriple rejects (anti-drift, every cell)', () => {
    const channelTypes: ChannelType[] = ['voice', 'text'];
    const gameIds: Array<number | null | undefined> = [null, undefined, 0, 42];
    for (const ct of channelTypes) {
      for (const gameId of gameIds) {
        const derived = deriveBindingPurpose(ct, gameId);
        expect(classifyBindingTriple(ct, derived, gameId)).toBeNull();
      }
    }
  });

  it('detectBehavior delegates to deriveBindingPurpose (same result on every cell)', () => {
    const channelTypes: ChannelType[] = ['voice', 'text'];
    const gameIds: Array<number | null | undefined> = [null, undefined, 0, 42];
    for (const ct of channelTypes) {
      for (const gameId of gameIds) {
        expect(detectBehavior(ct, gameId)).toBe(
          deriveBindingPurpose(ct, gameId),
        );
      }
    }
  });
});
