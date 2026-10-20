#!/usr/bin/env bash
# ROK-1793 S2 — shared fake for runner_drain::scan's `docker exec rl-runner-2
# sh -c <scan> rl-drain <count|kill> <task_id...>` call (Codex r5).
#
# Runner processes are modelled as lines of $RL_STATE_DIR/procs, one RL_TASK_ID
# marker per line. A scan counts the lines whose marker is one of the requested
# task ids; a kill removes exactly those lines, so any OTHER line (a new
# claimant's process) must survive. Knobs: SHIM_LINGER=N — the marked processes
# exit on their own after N count-scans; SHIM_SURVIVE=1 — they survive SIGKILL;
# SHIM_SCAN_ERR=1 — the scan exec fails. Each call logs slot 2's claimed flag
# at that moment to $1's log file ("scan claimed=…" / "kill claimed=… tids=…").

# write_drain_shim <path> <log> — write the fake as an executable at <path>.
write_drain_shim() {
    cat > "$1" <<SH
#!/usr/bin/env bash
S="$RL_STATE_DIR"; LOG="$2"
SH
    cat >> "$1" <<'SH'
c=$(jq -r '.[] | select(.slot == 2) | .claimed' "$S/claims.json")
[[ "${SHIM_SCAN_ERR:-0}" == 1 ]] && exit 1
a=("$@"); mode=""; tids=()
for ((i = 0; i < ${#a[@]}; i++)); do
    [[ "${a[i]}" == rl-drain ]] && { mode="${a[i+1]}"; tids=("${a[@]:i+2}"); break; }
done
procs="$S/procs"; touch "$procs"
count() { grep -cxF -f <(printf '%s\n' "${tids[@]}") "$procs" || true; }
drop() { local k; k=$(grep -vxF -f <(printf '%s\n' "${tids[@]}") "$procs" || true); printf '%s' "${k:+$k$'\n'}" > "$procs"; }
if [[ "$mode" == count ]]; then
    n=$(( $(cat "$S/scan.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/scan.n"
    echo "scan claimed=$c" >> "$LOG"
    (( n > ${SHIM_LINGER:-0} )) && [[ "${SHIM_SURVIVE:-0}" != 1 ]] && drop
    echo "drained=$(count)"
else
    echo "kill claimed=$c tids=${tids[*]}" >> "$LOG"
    n=$(count); [[ "${SHIM_SURVIVE:-0}" == 1 ]] || drop
    echo "drained=$n"
fi
SH
    chmod +x "$1"
}
