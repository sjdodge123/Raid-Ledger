/**
 * Normalises one Wings `console output` frame arg into clean console lines
 * (ROK-1821 F2). Pure; never logs or retains what it is given.
 *
 * Why (pelican-dev/wings @ 7b489da):
 * - Live frames come from `system.ScanReader` (system/utils.go:46-120), which
 *   replaces every `" \r"` inside a line with `"\r\n"` and emits the whole
 *   buffer as ONE frame — "the front-end can handle the linebreaks in the
 *   middle of the output". So one live arg can hold several lines.
 * - The `send logs` replay comes from `Readlog` (environment/docker/
 *   container.go:350-368): a `bufio.Scanner` over `docker logs`, one frame
 *   per `\n`-split line. So a replayed line never holds a break — the only
 *   live-vs-replay asymmetry in Wings' line handling.
 * - Neither path strips ANSI: `StripAnsi` only applies to Wings' own
 *   started-detection copy (server/listeners.go:152-200). The container runs
 *   with `Tty: true` (container.go:188), so colour codes and stray `\r` reach
 *   us verbatim and defeat a parser's `\s*$` anchors.
 */

/**
 * ANSI escape sequences: CSI (`ESC[…m`, `ESC[2K`, …), OSC (`ESC]…BEL`) and
 * the 8-bit CSI. Same shape as Wings' own `stripAnsiRegex`.
 */
const ANSI =
  // eslint-disable-next-line no-control-regex -- matching terminal escapes is the point
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]))/g;

/** Any line break a TTY stream can carry, including a bare carriage return. */
const BREAK = /\r\n|\r|\n/;

/** ANSI-stripped, break-split, right-trimmed, non-blank lines of one frame arg. */
export function consoleFrameLines(arg: string): string[] {
  return arg
    .replace(ANSI, '')
    .split(BREAK)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}
