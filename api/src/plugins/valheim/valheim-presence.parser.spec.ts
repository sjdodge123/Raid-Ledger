import { parseValheimLine } from './valheim-presence.parser';

/** Anonymised samples from docs/spikes/ROK-1798-valheim-pelican-quick-play.md Q1. */
const STEAM_A = '76561190000000001';
const STEAM_B = '76561190000000002';

describe('parseValheimLine — join (handshake)', () => {
  it('emits join with the SteamID64 and the parsed timestamp', () => {
    expect(
      parseValheimLine(
        `10/14/2026 00:10:50: Got handshake from client ${STEAM_A}`,
      ),
    ).toEqual({
      kind: 'join',
      steamId: STEAM_A,
      loggedAt: '2026-10-14T00:10:50',
    });
  });

  it('matches the on-disk BepInEx prefix too (unanchored)', () => {
    expect(
      parseValheimLine(
        `[Info   : Unity Log] 10/14/2026 00:10:50: Got handshake from client ${STEAM_A}`,
      ),
    ).toEqual({
      kind: 'join',
      steamId: STEAM_A,
      loggedAt: '2026-10-14T00:10:50',
    });
  });

  it('omits loggedAt when the line has no timestamp', () => {
    expect(parseValheimLine(`Got handshake from client ${STEAM_A}`)).toEqual({
      kind: 'join',
      steamId: STEAM_A,
    });
  });

  it('ignores the redundant "Got connection SteamID" line', () => {
    expect(
      parseValheimLine(
        `10/14/2026 00:10:50: Got connection SteamID ${STEAM_A}`,
      ),
    ).toBeNull();
  });
});

describe('parseValheimLine — character (ZDOID)', () => {
  it('emits a live character with its name', () => {
    expect(
      parseValheimLine(
        '10/14/2026 00:11:12: Got character ZDOID from Ragnhild : 123456789:1',
      ),
    ).toEqual({
      kind: 'character',
      name: 'Ragnhild',
      zdoidZero: false,
      ownerId: '123456789',
      loggedAt: '2026-10-14T00:11:12',
    });
  });

  it('flags a 0:0 ZDOID as a death (trap: not a leave)', () => {
    expect(
      parseValheimLine(
        '10/14/2026 02:45:04: Got character ZDOID from Bjorn : 0:0',
      ),
    ).toEqual({
      kind: 'character',
      name: 'Bjorn',
      zdoidZero: true,
      ownerId: '0',
      loggedAt: '2026-10-14T02:45:04',
    });
  });

  it('keeps spaces inside a character name and accepts a negative UID', () => {
    expect(
      parseValheimLine('Got character ZDOID from Old Bjorn : -42:4931'),
    ).toEqual({
      kind: 'character',
      name: 'Old Bjorn',
      zdoidZero: false,
      ownerId: '-42',
    });
  });

  it('treats 0:N (N > 0) as a live character, not a death', () => {
    expect(parseValheimLine('Got character ZDOID from Bjorn : 0:7')).toEqual({
      kind: 'character',
      name: 'Bjorn',
      zdoidZero: false,
    });
  });
});

describe('parseValheimLine — auth-failed (wrong password)', () => {
  it('emits auth-failed with the SteamID64', () => {
    expect(
      parseValheimLine(
        `10/14/2026 01:47:54: Peer ${STEAM_B} has wrong password`,
      ),
    ).toEqual({
      kind: 'auth-failed',
      steamId: STEAM_B,
      loggedAt: '2026-10-14T01:47:54',
    });
  });
});

describe('parseValheimLine — leave (closing socket)', () => {
  it('emits leave with the SteamID64', () => {
    expect(
      parseValheimLine(`10/14/2026 03:50:28: Closing socket ${STEAM_B}`),
    ).toEqual({
      kind: 'leave',
      steamId: STEAM_B,
      loggedAt: '2026-10-14T03:50:28',
    });
  });

  it('ignores mod chatter that names a peer (Seasonality)', () => {
    expect(
      parseValheimLine(`[Info   :Seasonality] Peer (${STEAM_B}) disconnected`),
    ).toBeNull();
  });

  it('ignores the disconnect noise around Closing socket', () => {
    for (const line of [
      '10/14/2026 03:50:28: RPC_Disconnect',
      '10/14/2026 03:50:28: Disposing socket',
      '10/14/2026 03:50:28:   send queue size:0',
    ]) {
      expect(parseValheimLine(line)).toBeNull();
    }
  });
});

describe('parseValheimLine — heartbeat (Connections N ZDOS:)', () => {
  it('emits the peer count from the ZDOS form', () => {
    expect(
      parseValheimLine(
        '10/14/2026 02:39:02:  Connections 5 ZDOS:180848  sent:2549 recv:1723',
      ),
    ).toEqual({
      kind: 'heartbeat',
      count: 5,
      loggedAt: '2026-10-14T02:39:02',
    });
  });

  it('emits a zero count', () => {
    expect(
      parseValheimLine(
        '10/14/2026 03:59:02:  Connections 0 ZDOS:211724  sent:0 recv:0',
      ),
    ).toEqual({
      kind: 'heartbeat',
      count: 0,
      loggedAt: '2026-10-14T03:59:02',
    });
  });

  it('ignores the bare dungeon-generation "Connections 4" (trap)', () => {
    expect(parseValheimLine('10/14/2026 00:20:11: Connections 4')).toBeNull();
  });
});

describe('parseValheimLine — server lifecycle', () => {
  it('emits server-ready on "Game server connected"', () => {
    expect(
      parseValheimLine('10/14/2026 00:09:02: Game server connected'),
    ).toEqual({
      kind: 'server-ready',
      loggedAt: '2026-10-14T00:09:02',
    });
  });

  it.each(['Game - OnApplicationQuit', 'ZNet Shutdown'])(
    'emits server-stopping on "%s"',
    (text) => {
      expect(parseValheimLine(`10/14/2026 04:00:04: ${text}`)).toEqual({
        kind: 'server-stopping',
        loggedAt: '2026-10-14T04:00:04',
      });
    },
  );
});

describe('parseValheimLine — everything else', () => {
  it.each([
    '10/14/2026 00:10:54: Network version check, their:40, mine:40',
    '10/14/2026 00:10:54: Server: New peer connected,sending global keys',
    'Placed locations in zone 3,-2 duration 12 ms',
    `Player history entry with index 3:  Persona (Steam_${STEAM_A}, abc123)`,
    '',
  ])('returns null for %j', (line) => {
    expect(parseValheimLine(line)).toBeNull();
  });

  it('never echoes a secret-bearing startup line', () => {
    expect(
      parseValheimLine(
        './valheim_server.x86_64 -name "Srv" -password "hunter2" -public 0',
      ),
    ).toBeNull();
  });
});
