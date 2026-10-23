// Shared spawner for the dashboard specs that boot server.js per test.
//
// PORT=0 + the bound port read back from the announce log. The old
// pick-a-free-port-then-close helper had a race: `node --test` runs the spec
// files in parallel, so a sibling file could bind the port in the gap. The
// spawned server then died with EADDRINUSE, the /health probe was answered by
// the SIBLING's server, the test read the sibling's STATE_DIR (CI: "0 !== 1"
// on claims_held_minutes), and kill() waited forever for an exit that had
// already happened, cancelling the rest of the file.
import { spawn } from 'node:child_process';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const spawnDashboard = (serverPath, env, stateDir) => new Promise((res, rej) => {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  // The announce line names this server's own STATE_DIR, so a match can
  // never be another process's server.
  const announce = new RegExp(`listening on :(\\d+), state=${escapeRe(stateDir)},`);
  const timer = setTimeout(() => rej(new Error(`server did not announce within 5s: ${err}`)), 5000);
  timer.unref();
  child.stderr.on('data', (c) => { err += c.toString('utf-8'); });
  child.stdout.on('data', (c) => {
    out += c.toString('utf-8');
    const m = out.match(announce);
    if (!m) return;
    clearTimeout(timer);
    const port = parseInt(m[1], 10);
    res({
      base: `http://127.0.0.1:${port}`,
      kill: () => new Promise((r) => {
        if (child.exitCode !== null || child.signalCode !== null) { r(); return; }
        child.once('exit', () => r());
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000).unref();
      }),
    });
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    rej(new Error(`server exited (${code}) before announcing: ${err}`));
  });
});
