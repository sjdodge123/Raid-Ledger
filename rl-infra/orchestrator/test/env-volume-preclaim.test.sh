#!/usr/bin/env bash
# ROK-1846 c6 (Codex r6 P1-2) — env-spin must not mount an rl-data-<slug>
# volume a runner pre-created through rl-docker-guard (it carries the guard's
# rl.guard.owner label). Drives bin/_env_volume.sh against a PATH-shim docker.
set -uo pipefail
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$(cd "$TEST_DIR/../bin" && pwd)"
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }

SHIM=$(mktemp -d -t rl-vol-shim.XXXXXX)
trap 'rm -rf "$SHIM"' EXIT
export SHIM_LOG="$SHIM/calls" VOL_STATE="$SHIM/state"
cat > "$SHIM/docker" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$SHIM_LOG"
if [[ "$1 $2" == "volume inspect" ]]; then
    state=$(cat "$VOL_STATE")
    [[ "$state" == "absent" ]] && exit 1
    [[ "$state" == "guard" ]] && { echo "slot-1"; exit 0; }
    echo "<no value>"; exit 0
fi
exit 0
SH
chmod +x "$SHIM/docker"
export PATH="$SHIM:$PATH"
# shellcheck source=../bin/_env_volume.sh
source "$BIN_DIR/_env_volume.sh"

run_case() { : > "$SHIM_LOG"; echo "$1" > "$VOL_STATE"; env_volume::ensure rl-data-victim victim 2> "$SHIM/err"; }

run_case guard; rc=$?
[[ $rc -ne 0 ]] && ok "a guard-owned rl-data volume is refused" || bad "guard-owned volume accepted (rc=$rc)"
grep -q "created by runner slot-1" "$SHIM/err" && ok "refusal names the runner" || bad "stderr: $(cat "$SHIM/err")"
grep -q "volume create" "$SHIM_LOG" && bad "created over a pre-claimed volume" || ok "nothing created over it"

run_case absent; rc=$?
[[ $rc -eq 0 ]] && ok "an absent volume is created" || bad "absent volume refused (rc=$rc)"
grep -q "volume create --label rl.role=env --label rl.env_slug=victim rl-data-victim" "$SHIM_LOG" \
    && ok "env-spin creates it labelled" || bad "calls: $(cat "$SHIM_LOG")"

run_case unlabelled; rc=$?
[[ $rc -eq 0 ]] && ok "a pre-guard unlabelled env volume is reused (recreate flow)" || bad "unlabelled volume refused"

grep -q 'env_volume::ensure "$VOL_PG" "$SLUG"' "$BIN_DIR/env-spin" \
    && ok "env-spin calls env_volume::ensure before the PG docker run" || bad "env-spin does not call env_volume::ensure"

echo "PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]]
