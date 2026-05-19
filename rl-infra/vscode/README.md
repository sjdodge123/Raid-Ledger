# VSCode Remote-SSH + Debugger Setup

The runner containers expose Node `--inspect` on port 9229, routed by Traefik
at `slot-N-debug.rl.lan`. VSCode connects via Remote-SSH directly to the
runner container's filesystem so stack-trace paths are clickable.

## One-time setup

1. Install the **Remote - SSH** and **Dev Containers** extensions in VSCode.
2. Add this to `~/.ssh/config` (replace `rl-infra.lan` with your VM hostname):

   ```sshconfig
   Host rl-slot-1
     HostName rl-infra.lan
     User rl
     RequestTTY force
     RemoteCommand docker exec -it rl-runner-1 bash
   Host rl-slot-2
     HostName rl-infra.lan
     User rl
     RequestTTY force
     RemoteCommand docker exec -it rl-runner-2 bash
   # Add rl-slot-3 / rl-slot-4 with the same shape once you enable the
   # `extra-slots` compose profile.
   ```

   In VSCode settings.json, set: `"remote.SSH.enableRemoteCommand": true`.

3. **Open Remote Window → Connect to Host... → rl-slot-N**.
   Open folder `/workspace`.

4. Copy `launch.json` from this directory to `.vscode/launch.json` in the
   workspace root (once per slot, since the workspace lives in the runner).

## launch.json — what's in here

- **Attach to API (slot N)** — attaches to the running `nest start --watch`
  process inside the runner.
- **Debug Jest current file** — runs jest with `--inspect-brk` on the open
  test file.
- **Debug Vitest current file** — same, for web tests.
- **Attach via Traefik** — connects to `slot-N-debug.rl.lan:9229` from the
  laptop (no SSH session needed; uses Chrome DevTools Protocol over WebSocket).

## Starting the API in inspect mode

Inside the runner shell (`rl shell`):

```bash
cd /workspace/api
NODE_OPTIONS='--inspect=0.0.0.0:9229' npm run start:dev
```

Then attach from either:
- VSCode (Remote-SSH session): `Attach to API (in-runner)`
- VSCode (laptop, no SSH): `Attach via Traefik`
- Chrome: `chrome://inspect` → Configure → add `slot-N-debug.rl.lan:9229`
