# rl-infra — Setup Guide

End-to-end provisioning of the remote test fleet. Follow phases in order; each
phase ends with a verification step. Architecture context lives in `README.md` —
this file is the step-by-step.

**Time budget:** ~2 hours start to finish (most of it is the Ubuntu install +
first allinone build).

---

## Phase 0 — Prerequisites

Before you start, gather these. If anything's missing, stop and resolve it —
fixing them mid-flow is more painful than up-front.

| Item | Required value / version | How to check |
| ---- | ------------------------ | ------------ |
| Proxmox VE | 8.x | Web UI footer or `pveversion` |
| Free RAM on Proxmox host | ≥ 16 GB allocatable to one VM (default 2-slot fleet) — ≥ 32 GB for 4-slot via `extra-slots` profile | `free -g` on the Proxmox host |
| Free disk on Proxmox storage | ≥ 250 GB | `pvesm status` |
| Local network static IP plan | One IP for the VM (e.g. `192.168.1.50`) | router DHCP reservations |
| Wildcard DNS capability | Either Pi-hole / AdGuard, dnsmasq, or your router supports `*.rl.lan` | see Phase 2 |
| Laptop SSH keypair | `~/.ssh/id_ed25519` exists | `ls ~/.ssh/id_ed25519.pub` |
| Mutagen on laptop | Will install in Phase 5 | n/a |
| Docker Hub / `pgvector/pgvector:pg16` reachable from the VM | yes | `docker pull pgvector/pgvector:pg16` after VM is up |

If your Proxmox host is on ZFS, the snapshot/rollback feature in `rl snapshot`
will work; if it's on LVM-thin or ext4, snapshots are optional and that command
will no-op gracefully.

---

## Phase 1 — Provision the VM on Proxmox

### 1.1  Download the Ubuntu 24.04 cloud image

On the Proxmox host shell (web UI → host → Shell, or SSH in):

```bash
cd /var/lib/vz/template/iso
wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
```

### 1.2  Create the VM

Pick an unused VMID (e.g. `200`). Adjust storage name (`local-lvm`) to whatever
your Proxmox storage is called.

**Sizing (default 2-slot fleet, 16 GB):** assumes Proxmox host has ~16 GB free.
For the 4-slot fleet via the `extra-slots` compose profile, double `--memory`
to `32768` and bump `--cores` to 8.

```bash
qm create 200 \
  --name rl-infra \
  --memory 16384 \
  --cores 6 \
  --balloon 8192 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci \
  --ostype l26 \
  --agent enabled=1
qm importdisk 200 /var/lib/vz/template/iso/noble-server-cloudimg-amd64.img local-lvm
# `cache=writeback` is critical for fleet performance: postgres testcontainer
# fsyncs land in the VM's RAM cache, not the host's spinning/SSD storage, which
# brings integration-test wallclock from hours to minutes. Trade-off is host
# crash mid-test loses recent writes — acceptable for a dev/test VM with
# rebuildable state. See ROK-1331 dogfood discovery (2026-05-20).
qm set 200 --scsi0 local-lvm:vm-200-disk-0,cache=writeback
qm resize 200 scsi0 +250G
qm set 200 --ide2 local-lvm:cloudinit
qm set 200 --boot c --bootdisk scsi0
qm set 200 --serial0 socket --vga serial0
```

`--balloon 8192` lets Proxmox reclaim RAM from this VM down to 8 GB if the
host gets pressured (e.g. you grow pelican-panel later). Set `--balloon 0` to
disable; the VM will then hold the full 16 GB hard.

### 1.3  Stage the cloud-init file

The cloud-init in this repo lives at `rl-infra/proxmox/cloud-init.yaml`.
Before you upload it:

1. Open it locally and replace the placeholder SSH key line:
   ```yaml
   ssh_authorized_keys:
     - ssh-ed25519 AAAA...REPLACE_ME laptop@home
   ```
   with the contents of `~/.ssh/id_ed25519.pub` from your laptop.

2. SCP it to the Proxmox host's snippets storage (Datacenter → Storage → pick
   one that supports "Snippets" content, usually `local`):
   ```bash
   scp rl-infra/proxmox/cloud-init.yaml \
       root@proxmox-host:/var/lib/vz/snippets/rl-infra.cloud-init.yaml
   ```

3. Tell the VM to use it:
   ```bash
   qm set 200 --cicustom "user=local:snippets/rl-infra.cloud-init.yaml"
   ```

### 1.4  Network — static IP + hostname

Either (a) make a DHCP reservation in your router for the VM's MAC address (run
`qm config 200 | grep net0` to get it), OR (b) set a static via cloud-init's
`ipconfig0`:

```bash
qm set 200 --ipconfig0 ip=192.168.1.50/24,gw=192.168.1.1
```

(Adjust subnet + gateway to your LAN.)

### 1.5  Boot

```bash
qm start 200
```

Watch boot progress via the Proxmox web UI's "Console" tab for VM 200. First
boot runs cloud-init and installs Docker — it takes ~5 minutes. When you see
the `rl-infra ready` message, it's done.

### 1.6  Verify

From your laptop:

```bash
ssh rl@192.168.1.50 'docker version && which docker-compose'
# expect: Docker CE 27+, Server: ... and docker-compose plugin path
```

If SSH fails, the public key wasn't applied — re-check Step 1.3, then
`qm set 200 --ciforce 1 && qm reboot 200`.

---

## Phase 2 — Wildcard DNS for `*.rl.lan`

You need every `*.rl.lan` hostname to resolve to the VM's IP from the laptop.
Pick one option.

### Option A — Pi-hole (recommended if you run one)

In Pi-hole admin → **Local DNS → DNS Records**:

| Domain | IP |
| ------ | -- |
| `rl.lan` | `192.168.1.50` |
| `*.rl.lan` | `192.168.1.50` |

Pi-hole's UI only takes exact hostnames, not wildcards. For true wildcard,
edit `/etc/dnsmasq.d/02-rl-infra.conf` on the Pi-hole host:

```
address=/.rl.lan/192.168.1.50
```

Then `pihole restartdns`. Verify on the laptop: `dig slot-1.rl.lan +short` →
`192.168.1.50`.

### Option B — AdGuard Home

Filters → **DNS rewrites** → add `*.rl.lan → 192.168.1.50`. AdGuard supports
wildcards natively. Verify with `dig` as above.

### Option C — Just `/etc/hosts` (quick start)

Skip true wildcards. Add to laptop `/etc/hosts`:

```
192.168.1.50  rl-infra.lan traefik.rl.lan grafana.rl.lan registry.rl.lan
192.168.1.50  slot-1.rl.lan slot-1-debug.rl.lan
192.168.1.50  slot-2.rl.lan slot-2-debug.rl.lan
192.168.1.50  slot-3.rl.lan slot-3-debug.rl.lan
192.168.1.50  slot-4.rl.lan slot-4-debug.rl.lan
```

Per-env hostnames (`{slug}.rl.lan`) won't resolve until you add each. Fine for
a first smoke test; move to A or B when you're using the fleet daily.

### 2.1  Verify

```bash
ping -c1 traefik.rl.lan
# expect: 64 bytes from 192.168.1.50
```

---

## Phase 3 — Deploy the stack into the VM

### 3.1  Copy the stack files to the VM

From the laptop, in the repo root:

```bash
./rl-infra/deploy.sh        # target override: RL_DEPLOY_TARGET=rl@<ip>
```

This copies docker-compose.yml, the runner Dockerfile, orchestrator scripts,
Traefik/Loki/Grafana configs, and the gc-sweeper — then restores exec bits,
re-asserts the rl-fleet group perms on `traefik/conf.d`, rebuilds the
gc-sweeper image (sweep.sh is baked in at build time), and stamps
`.deployed_sha`.

> **Do NOT use a bare `rsync -avh` here.** `-a` replicates the laptop's
> directory permissions onto live VM dirs and strips the group-write + setgid
> bits rl-agent needs on `traefik/conf.d` — after which every env-spin aborts
> at the Traefik route write and `rl_env_destroy` can't remove route files
> (observed 2026-06-06). `deploy.sh` rsyncs content-only and re-asserts perms.

### 3.2  Set the env file

```bash
ssh rl@192.168.1.50
cd /srv/rl-infra
cp .env.example .env
sed -i "s/GRAFANA_ADMIN_PASSWORD=changeme/GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 18)/" .env
cat .env   # note the password somewhere safe
```

### 3.3  Make scripts executable

The rsync may have stripped exec bits. While SSH'd in:

```bash
chmod +x /srv/rl-infra/orchestrator/bin/*
chmod +x /srv/rl-infra/gc-sweeper/sweep.sh
chmod +x /srv/rl-infra/runner/entrypoint.sh
```

### 3.4  Build the runner + sweeper images, start the stack

Still in the VM, `/srv/rl-infra`:

```bash
docker compose build runner-1 gc-sweeper   # builds the 2 custom images
docker compose up -d                       # starts 2 slots + infra (default profile)
# If you've sized the VM for 4 slots and want them all running, instead:
#   docker compose --profile extra-slots up -d
#   # then bump RUNNER_SLOTS=4 in .env and re-run ./orchestrator/bin/init-state
```

First build takes ~6–8 minutes (Playwright base image is large). Subsequent
builds are cached.

### 3.5  Initialize the state files

```bash
./orchestrator/bin/init-state
# expect: claims (4 slots), envs (0 active), audit log path
```

### 3.6  Verify

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | sort
```

You should see all of these `Up` and healthy:

```
rl-gc-sweeper      Up
rl-grafana         Up
rl-loki            Up
rl-promtail        Up
rl-registry        Up
rl-runner-1        Up
rl-runner-2        Up
rl-traefik         Up
```

(If you enabled the `extra-slots` profile, you'll also see `rl-runner-3` and
`rl-runner-4`.)

From the laptop, hit a few URLs:

- `http://traefik.rl.lan/dashboard/` — Traefik UI (read-only)
- `http://grafana.rl.lan` — log in with `admin` + the password from Step 3.2
- `http://registry.rl.lan/v2/_catalog` — should return `{"repositories":[]}`

If any are unreachable, jump to **Troubleshooting → DNS / Traefik**.

---

## Phase 4 — Build & publish the allinone image

`rl env spin` pulls from `registry.rl.lan/rl-allinone:<tag>`. Until you publish
at least one image, env spinning will fail. You only do this once; CI can take
over for branch-tagged images later.

### 4.1  Allow insecure pulls from the local registry

The registry runs plain HTTP on the LAN. On the VM, edit
`/etc/docker/daemon.json` and add:

```json
{
  "insecure-registries": ["registry.rl.lan"]
}
```

(Merge with the existing JSON — don't replace.) Then:

```bash
sudo systemctl restart docker
docker compose up -d   # restart the stack after dockerd bounce
```

### 4.2  Build the image (first time, on the VM)

The image build needs the full Raid-Ledger source. Easiest first-time path: do
it on the VM. On the laptop, sync the worktree once:

```bash
rsync -avh --exclude='node_modules' --exclude='dist' \
    ~/Documents/Projects/Raid-Ledger/ \
    rl@192.168.1.50:/srv/rl-infra/build-src/
```

Then on the VM:

```bash
cd /srv/rl-infra/build-src
docker build -f Dockerfile.allinone -t registry.rl.lan/rl-allinone:latest .
docker push registry.rl.lan/rl-allinone:latest
```

This takes ~10–15 minutes the first time (npm install across all workspaces +
Vite build + Nest build).

### 4.3  Verify

```bash
curl http://registry.rl.lan/v2/_catalog
# expect: {"repositories":["rl-allinone"]}

curl http://registry.rl.lan/v2/rl-allinone/tags/list
# expect: {"name":"rl-allinone","tags":["latest"]}
```

### 4.4  (Later) — automate branch image builds

Eventually each branch should produce its own tag. The cheap version: a
post-receive hook on the VM, OR a GitHub Actions workflow that builds and
pushes `registry.rl.lan/rl-allinone:<branch-slug>`. Not required for the
first cut — `latest` is enough to test the loop.

---

## Phase 5 — Laptop-side setup

### 5.1  Install Mutagen

```bash
brew install mutagen-io/mutagen/mutagen
mutagen daemon start
```

Verify: `mutagen version` prints `0.18.x` or newer.

### 5.2  SSH config

Edit `~/.ssh/config`, add:

```sshconfig
Host rl-infra
  HostName 192.168.1.50
  User rl
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30
  ServerAliveCountMax 4

# VSCode Remote-SSH targets — one per slot.
Host rl-slot-1
  HostName 192.168.1.50
  User rl
  IdentityFile ~/.ssh/id_ed25519
  RequestTTY force
  RemoteCommand docker exec -it rl-runner-1 bash
Host rl-slot-2
  HostName 192.168.1.50
  User rl
  IdentityFile ~/.ssh/id_ed25519
  RequestTTY force
  RemoteCommand docker exec -it rl-runner-2 bash
# If you enable the `extra-slots` compose profile, add rl-slot-3 and rl-slot-4
# blocks too (same shape, just bump the runner-N container name).
```

Test: `ssh rl-infra 'echo ok'` → `ok`.

### 5.3  Environment variables

Append to `~/.zshrc` (or `~/.bashrc`):

```bash
export RL_PROXMOX_HOST=rl-infra
export RL_PROXMOX_USER=rl
# RL_TARGET defaults to auto — leave unset unless overriding.
```

Reload: `source ~/.zshrc`.

### 5.4  Put `rl` on your PATH

Two equivalent options.

**Option A — symlink (simpler):**

```bash
ln -s ~/Documents/Projects/Raid-Ledger/rl-infra/cli/rl /usr/local/bin/rl
```

**Option B — PATH:**

```bash
echo 'export PATH="$HOME/Documents/Projects/Raid-Ledger/rl-infra/cli:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Verify: `which rl` resolves to the right file.

### 5.5  VSCode setup

1. Install the **Remote - SSH** extension.
2. VSCode settings.json → add: `"remote.SSH.enableRemoteCommand": true`.
3. Command Palette → "Remote-SSH: Connect to Host" → `rl-slot-1`. VSCode opens
   a window connected to the runner container's filesystem.
4. Open folder `/workspace`.
5. Copy `rl-infra/vscode/launch.json` to `.vscode/launch.json` in that
   `/workspace` view. (You're inside the runner now, so this writes into the
   runner's filesystem, which Mutagen will sync back when you claim a slot.)

### 5.6  Verify end-to-end

From the laptop:

```bash
rl doctor
```

Expected output:

```
=== rl doctor ===
RL_TARGET (resolved): remote
RL_AGENT_ID:          sdodge-a1b2c3d4
RL_PROXMOX_HOST:      rl-infra
SSH connect:          ok
Orchestrator:         ok
Mutagen daemon:       Running
Active sync sessions: 0
```

Any `FAILED` lines → see **Troubleshooting**.

---

## Phase 6 — First claim (smoke test)

This proves the whole loop works.

### 6.1  Claim a slot

```bash
cd ~/Documents/Projects/Raid-Ledger
git checkout main      # or any branch
rl claim --branch $(git branch --show-current)
```

Expected output:

```json
{
  "ok": true,
  "slot": 1,
  "agent_id": "sdodge-a1b2c3d4",
  "branch": "main",
  "hostnames": { "web": "slot-1.rl.lan", "debug": "slot-1-debug.rl.lan" },
  "worktree": "/srv/rl-infra/runners/slot-1/worktree",
  "container": "rl-runner-1",
  "shell_cmd": "docker exec -it rl-runner-1 tmux attach -t main"
}

claimed slot 1
  worktree synced to: /srv/rl-infra/runners/slot-1/worktree
  shell:       rl shell
  web url:     https://slot-1.rl.lan
  debug url:   https://slot-1-debug.rl.lan
```

Behind the scenes: Mutagen created a sync session, started uploading your
worktree, and the heartbeat daemon is now running in the background.

### 6.2  Watch the sync complete

```bash
mutagen sync list rl-slot-1
# look for: "Status: Watching for changes" — that's the steady state
```

First sync takes 30–90s depending on repo size. Mutagen prints
`Status: Staging files on beta` while it's working.

### 6.3  Shell into the runner

```bash
rl shell
```

You're now in a tmux session inside `rl-runner-1`. Verify:

```bash
ls /workspace                          # your code
ls /workspace/node_modules || echo MISSING
```

`node_modules` won't be synced (Mutagen excludes it) and lives in a named
volume per slot. First time, install:

```bash
cd /workspace
npm install
npm run build -w packages/contract
```

This populates `runner-1-node-modules` and persists across rebuilds.

Detach tmux: `Ctrl-b d` (you stay attached on next `rl shell`).

### 6.4  Spin a smoke env

```bash
exit   # leave the SSH session if you're still in it
rl env spin smoke-test
```

Expected output:

```json
{
  "ok": true,
  "slug": "smoke-test",
  "url": "https://smoke-test.rl.lan",
  "slot": 1,
  "app_container": "rl-env-smoke-test-allinone",
  "pg_container": "rl-env-smoke-test-pg"
}
```

If you used Option C (`/etc/hosts`) for DNS, add `192.168.1.50 smoke-test.rl.lan`
first or skip this verification.

### 6.5  Hit the env

```bash
curl https://smoke-test.rl.lan/api/health
# expect: {"status":"ok","db":{"connected":true},...}
```

Open `https://smoke-test.rl.lan` in a browser — Raid Ledger should load with
DEMO_MODE prefilled credentials.

### 6.6  Tear it down

```bash
rl env destroy smoke-test
rl release
```

`rl status` should show all 4 slots free and 0 active envs.

---

## Phase 7 — VSCode debugger (Node `--inspect`)

You've already done the SSH config in Phase 5. Now wire up the debugger.

### 7.1  Start the API with --inspect

In `rl shell`:

```bash
cd /workspace/api
NODE_OPTIONS='--inspect=0.0.0.0:9229' npm run start:dev
```

Wait for `Nest application successfully started`.

### 7.2  Attach from VSCode

In your laptop VSCode (Remote-SSH window on `rl-slot-1`):

1. F5 (or Run → Start Debugging).
2. Pick `Attach to API (in-runner)`.
3. Set a breakpoint in `api/src/auth/auth.controller.ts`.
4. Hit a protected endpoint via `curl https://slot-1.rl.lan/api/...`.
5. VSCode pauses on the breakpoint.

### 7.3  Alternative — attach from laptop without SSH session

If you'd rather attach from a "regular" VSCode window (not Remote-SSH):

1. Open the repo locally.
2. Pick `Attach via Traefik (from laptop)` from launch.json.
3. Make sure `slot-1-debug.rl.lan` resolves (DNS / hosts).

The connection goes laptop → Traefik → runner :9229. Stack frame paths will
still resolve correctly because `localRoot` + `remoteRoot` are mapped to
`/workspace`.

---

## Phase 8 — Make it the default for your flow

Now that everything works, flip the default for the Raid-Ledger skills.

### 8.1  Always-on RL_TARGET

In `~/.zshrc`:

```bash
export RL_TARGET=auto   # explicit, though it's already the default
```

`auto` means: probe SSH at session start, use remote if reachable, local if not.
On the plane → `RL_TARGET=local` (per-command) or unset it after explicitly
forcing local once.

### 8.2  Trust the existing skill flows

`/build`, `/fix-batch`, `/bulk`, `/dispatch`, `/push`, `/handover`, and
`/status-report` already know about `rl claim` / `rl validate-ci` (see their
SKILL.md headers and `_shared/rl-infra-fleet.md`). They auto-route when
`RL_TARGET=remote`.

`scripts/validate-ci.sh` self-dispatches to `rl validate-ci` in remote mode, so
nothing in the existing push pipeline needs editing on your side.

### 8.3  Daily flow

```bash
rl claim --branch $(git branch --show-current)   # start of session
# … edit on laptop, Mutagen syncs continuously, run heavy stuff via rl …
rl release                                       # end of session
```

That's it.

---

## Troubleshooting

### `rl claim` returns "no_free_slot"

All 4 slots are busy. `rl status` shows who holds them. If a claimant is
genuinely dead, the gc-sweeper releases stale claims every 15 min (heartbeat
timeout 5 min). To force a sweep: `rl gc`.

### `rl doctor` says `SSH connect: FAILED`

- Check `ssh rl-infra 'echo ok'` directly. If that fails, your SSH key isn't on
  the VM. Re-check cloud-init step 1.3, or copy manually:
  `ssh-copy-id rl@192.168.1.50`.
- If SSH works but `rl doctor` still fails, check `RL_PROXMOX_HOST` matches the
  SSH config Host alias.

### Mutagen "agent installation failed"

The VM is missing the mutagen-agent binary. Either:

- The cloud-init step that installed it failed → SSH in and:
  `curl -fsSL https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz | tar -xz -C /usr/local/bin mutagen mutagen-agent && chmod +x /usr/local/bin/mutagen*`
- Mutagen version on the laptop doesn't match — both sides should be 0.18.x.

### `rl env spin` fails with "no such image"

You skipped Phase 4. Build + push `registry.rl.lan/rl-allinone:latest` first.

### `rl env spin` fails with "manifest unknown" or "x509: cert signed by unknown"

You forgot to mark the registry as insecure (Phase 4.1). Edit
`/etc/docker/daemon.json` on the VM, add the `insecure-registries` entry,
restart docker.

### Traefik returns 404 for `slot-N.rl.lan`

The runner container hasn't booted yet, OR the labels didn't apply. Check:

```bash
ssh rl-infra 'docker logs rl-traefik 2>&1 | grep -i error | tail'
ssh rl-infra 'docker inspect rl-runner-1 --format "{{ json .Config.Labels }}" | jq .'
```

If labels are missing, your `docker-compose.yml` was edited or the stack didn't
pick up the file → `docker compose up -d --force-recreate runner-1`.

### Grafana shows "no data" in Loki dashboards

Promtail isn't shipping. Check:

```bash
ssh rl-infra 'docker logs rl-promtail 2>&1 | tail'
```

Common cause: it can't reach `/var/run/docker.sock`. Verify the bind mount in
the compose file is correct and the host docker daemon is running.

### Tests fail in the runner with "out of memory"

The default 4 GB per runner (16 GB VM sizing) is enough for typical Jest/Vitest
runs, but Playwright + parallel test workers can spike. Bump in
`docker-compose.yml`:

```yaml
runner-1:
  mem_limit: 6g
```

Then `docker compose up -d --force-recreate runner-1`. Rough budget:
`(vm_ram_gb - 4) / runner_count` per slot — leaves room for the infra services
and one or two active env stacks.

### Heartbeat daemon running forever after I closed the terminal

The bg daemon's pidfile is at `~/.rl-heartbeat-<slot>.pid`. If `rl release`
didn't clean it up (e.g. SSH was already down):

```bash
kill $(cat ~/.rl-heartbeat-*.pid)
rm ~/.rl-heartbeat-*.pid
```

The sweeper will then auto-release the slot within ~5 min anyway.

### Need to start over

```bash
ssh rl-infra
cd /srv/rl-infra
docker compose down -v   # drops volumes (loses Loki history + node_modules caches)
rm -rf state/*
./orchestrator/bin/init-state
docker compose up -d
```

`-v` is destructive — only use it if you're ok losing log history and per-slot
node_modules.

---

## Operator quick reference

```bash
rl claim --branch foo       # start
rl status                   # who's where
rl shell                    # tmux in your slot
rl env spin smoke           # prod-like env at smoke.rl.lan
rl db smoke --web           # pgweb in browser
rl logs '{rl_slot="1"}'     # Grafana with filter
rl validate-ci --full       # ship-it
rl release                  # end
```

Architecture diagram + design rationale: `README.md`.
Per-skill changes when `RL_TARGET=remote`: `.claude/skills/_shared/rl-infra-fleet.md`.

---

## Phase 9 — Slot-stable hostnames for OAuth (ROK-1324)

Discord OAuth (and any strict-redirect-URI provider) requires every callback URL to be pre-registered in the developer portal. Per-slug URLs (`<slug>test.gamernight.net`) can't satisfy that — slugs are arbitrary. Solution: **slot-stable hostnames** (`slot-1.gamernight.net`, `slot-2.gamernight.net`) registered once, routed to whichever env is currently on that slot.

This is a one-time setup; once done, "Continue with Discord" works on any fleet env.

### 9.1  DNS (Cloudflare)

`slot-N.gamernight.net` needs to resolve to the same target as `*.gamernight.net`.

- If your wildcard is already `*.gamernight.net` (single-level), `slot-1` and `slot-2` are already covered — no DNS change.
- Verify: `dig +short slot-1.gamernight.net` returns your reverse-proxy / VM target IP.
- If your wildcard is more restrictive (e.g. `*test.gamernight.net`), add explicit A or CNAME records for `slot-1` and `slot-2`.

### 9.2  Discord developer portal (one-time)

For each Raid Ledger OAuth app you use with the fleet (typically just the dev/test app, NOT prod):

1. Go to https://discord.com/developers/applications → your app → **OAuth2** → **General**
2. **Redirects** section → click **Add Another**
3. Add `https://slot-1.gamernight.net/api/auth/discord/callback`
4. Add another → `https://slot-2.gamernight.net/api/auth/discord/callback`
5. Save

Existing redirects (prod, localhost dev, etc.) stay untouched — these are additive.

If you later expand to slots 3+ (via the `extra-slots` compose profile), add `slot-3` and `slot-4` redirect URIs too.

### 9.3  How it works at runtime

When `rl env spin --slug foo` runs on slot 1:

- Traefik route covers BOTH `footest.gamernight.net` AND `slot-1.gamernight.net` (single route file at `traefik/conf.d/env-foo.yml`).
- The allinone container receives `DISCORD_CALLBACK_URL=https://slot-1.gamernight.net/api/auth/discord/callback` as an env var. The existing `DiscordStrategy` in `api/src/auth/discord.strategy.ts` reads this directly — no API code change required.
- `rl env spin` output (and the `rl_env_spin` / `rl_env_deploy` MCP responses) carry a new `slot_url` field. Use that for OAuth-flow test steps; use the per-slug `url` for everything else.

### 9.4  What happens when a slot is empty

If no env is on `slot-N`, Traefik has no matching route → 502 Bad Gateway. There's no friendly placeholder page (v1 trade-off). Document this for testers who might bookmark `slot-1.gamernight.net` directly.

### 9.5  Test plan deep-link guidance

When writing test plans via `rl_test_plan_create`, use the slot URL for steps that exercise OAuth login:

```js
{ description: "Sign in with Discord",
  test_url: "https://slot-1.gamernight.net/login",   // slot URL, not per-slug
  expected: "Lands on the home page authenticated as your Discord user" }
```

Use the per-slug URL (`<slug>test.gamernight.net`) for everything else — it's the friendlier name and reflects which env the tester is poking at.
