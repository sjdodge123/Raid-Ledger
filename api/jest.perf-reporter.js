// ROK-1331 M11 — Jest custom reporter that emits per-suite + per-shard
// perf events to /workspace/.rl-perf.log (inside the fleet runner) or to
// the worktree's .rl-perf.log on a local laptop run.
//
// Writes synchronously via appendFileSync — ~ µs cost per suite (a few
// hundred per shard), well under any actual jest run time. Per spec §4
// the reporter never blocks teardown; we wrap every write in a try/catch.
//
// Coordinates with M10's shard env (JEST_SHARD_ID + JEST_TOTAL_SHARDS set
// by the validate-ci shard loop). When the env vars are absent, the
// reporter still emits jest.suite.end events with shard_id=null —
// degradation surface is acceptable (AC2 still reaches step-level).

'use strict';

const { appendFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const PERF_LOG_PATH = existsSync('/workspace')
  ? '/workspace/.rl-perf.log'
  : path.resolve(__dirname, '..', '.rl-perf.log');

const SOURCE_LABEL = existsSync('/workspace') ? 'runner' : 'mcp';

const isoNowMs = () => {
  const d = new Date();
  const ms = d.getUTCMilliseconds().toString().padStart(3, '0');
  return `${d.toISOString().slice(0, 19)}.${ms}Z`;
};

const emit = (event, extra) => {
  try {
    const line = JSON.stringify({
      ts: isoNowMs(),
      event,
      source: SOURCE_LABEL,
      branch: process.env.GITHUB_REF_NAME || process.env.BRANCH || 'unknown',
      ...(process.env.RL_SLOT ? { slot: parseInt(process.env.RL_SLOT, 10) } : {}),
      ...extra,
    });
    appendFileSync(PERF_LOG_PATH, line + '\n');
  } catch {
    // Never fail the test run on a perf emit. perf logging is best-effort.
  }
};

class PerfReporter {
  constructor(globalConfig, options) {
    this._shardId = process.env.JEST_SHARD_ID ?? null;
    this._totalShards = process.env.JEST_TOTAL_SHARDS ?? null;
    this._suitesSeen = 0;
    this._heapPeakMb = 0;
    this._shardStartMs = Date.now();
  }

  onTestResult(_test, testResult) {
    const suitePath = testResult.testFilePath
      ? path.relative(process.cwd(), testResult.testFilePath)
      : null;
    const durationMs = typeof testResult.perfStats?.runtime === 'number'
      ? testResult.perfStats.runtime
      : 0;
    const numTests = (testResult.testResults?.length) ?? 0;
    const numFailed = testResult.numFailingTests ?? 0;
    // testResult.memoryUsage is set when --logHeapUsage is on (M10's path).
    const heapMb = typeof testResult.memoryUsage === 'number'
      ? Math.round(testResult.memoryUsage / 1024 / 1024)
      : null;
    if (heapMb !== null && heapMb > this._heapPeakMb) this._heapPeakMb = heapMb;
    this._suitesSeen += 1;
    emit('jest.suite.end', {
      suite_path: suitePath,
      duration_ms: durationMs,
      num_tests: numTests,
      num_failed: numFailed,
      heap_used_mb: heapMb,
      shard_id: this._shardId,
      total_shards: this._totalShards,
    });
  }

  onRunComplete() {
    emit('jest.shard.end', {
      shard_id: this._shardId,
      total_shards: this._totalShards,
      suites: this._suitesSeen,
      heap_peak_mb: this._heapPeakMb,
      duration_ms: Date.now() - this._shardStartMs,
    });
  }
}

module.exports = PerfReporter;
