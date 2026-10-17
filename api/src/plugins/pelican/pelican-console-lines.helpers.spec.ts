import { parseValheimLine } from '../valheim/valheim-presence.parser';
import { consoleFrameLines } from './pelican-console-lines.helpers';

/** Real Valheim console text (anonymised SteamIDs / names). */
const JOIN = '10/16/2026 17:27:02: Got handshake from client 76561190000000001';
const CHAR =
  '10/16/2026 17:27:09: Got character ZDOID from Thorvald : 123456789:1';
const LEAVE = '10/16/2026 17:40:00: Closing socket 76561190000000001';

const kinds = (arg: string) =>
  consoleFrameLines(arg).map((l) => parseValheimLine(l)?.kind ?? null);

describe('consoleFrameLines — realistic Wings frames (ROK-1821 F2)', () => {
  it('passes a clean single-line frame through unchanged', () => {
    expect(consoleFrameLines(JOIN)).toEqual([JOIN]);
  });

  it('splits a live ScanReader frame whose " \\r" became an embedded "\\r\\n"', () => {
    // system/utils.go: `bytes.Replace(line, " \r", "\r\n")`, one frame emitted.
    const frame = `${JOIN}\r\n${CHAR}\r\n`;
    expect(consoleFrameLines(frame)).toEqual([JOIN, CHAR]);
    expect(kinds(frame)).toEqual(['join', 'character']);
  });

  it('the unsplit multi-line frame defeats the parser anchors (the bug)', () => {
    expect(parseValheimLine(`${JOIN}\r\n${CHAR}`)?.kind).toBe('character');
    expect(parseValheimLine(`${LEAVE}\r\n${JOIN}`)?.kind).toBe('join');
  });

  it('strips ANSI colour codes around and inside a TTY line', () => {
    const frame = `\u001b[0;32m${JOIN}\u001b[0m`;
    expect(parseValheimLine(frame)).toBeNull();
    expect(consoleFrameLines(frame)).toEqual([JOIN]);
    expect(kinds(`\u001b[1m${LEAVE}\u001b[39;49m\u001b[K`)).toEqual(['leave']);
  });

  it('drops a trailing carriage return and splits on a bare one', () => {
    expect(consoleFrameLines(`${JOIN}\r`)).toEqual([JOIN]);
    expect(consoleFrameLines(`${JOIN}\r${LEAVE}`)).toEqual([JOIN, LEAVE]);
  });

  it('drops blank and whitespace-only lines (Unity prints " " spacers)', () => {
    expect(consoleFrameLines(`${JOIN}\r\n \r\n\r\n`)).toEqual([JOIN]);
    expect(consoleFrameLines('  \r\n')).toEqual([]);
  });

  it('strips an OSC title sequence', () => {
    expect(consoleFrameLines(`\u001b]0;valheim\u0007${CHAR}`)).toEqual([CHAR]);
  });
});
