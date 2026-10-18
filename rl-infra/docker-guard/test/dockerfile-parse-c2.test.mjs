// ROK-1846 c2 — the Dockerfile policy must hold under every way Docker's
// parser could read the file (BuildKit's `([^\\])\\[ \t]*$` continuation, the
// older `\\[ \t]*$` one, either escape token) and line-by-line as a backstop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerfileReason } from '../src/dockerfile-policy.mjs';

const URL_ADD = 'ADD http://127.0.0.1:2375/containers/victim/json /leak';

test('an escaped trailing backslash does not hide the next line (Codex c2 P1)', () => {
  assert.notEqual(dockerfileReason(`FROM a\nRUN echo \\\\\n${URL_ADD}\n`), null);
});

test('every continuation trick is refused', () => {
  const cases = {
    singleBackslash: `FROM a\nRUN echo \\\n${URL_ADD}\n`,
    trailingWhitespace: `FROM a\nRUN echo \\ \t\n${URL_ADD}\n`,
    crlf: `FROM a\r\nRUN echo \\\r\n${URL_ADD}\r\n`,
    loneCr: `FROM a\rRUN echo x\r${URL_ADD}\r`,
    commentInside: `FROM a\nADD \\\n# hidden\n  http://x/y /z\n`,
    emptyInside: `FROM a\nADD \\\n\n  http://x/y /z\n`,
    splitKeyword: `FROM a\nAD\\\nD http://x/y /z\n`,
    escapeBacktick: `# escape=\`\nFROM a\nRUN echo \\\n${URL_ADD}\n`,
    escapeBacktickJoin: `# syntax=docker/dockerfile:1\n# escape=\`\nFROM a\nADD \`\n  http://x/y /z\n`,
    undeclaredBacktick: `FROM a\nADD \`\n  http://x/y /z\n`,
    eofContinuation: `FROM a\n${URL_ADD} \\`,
    heredoc: `FROM a\nRUN <<EOF\necho hi\nEOF\n${URL_ADD}\n`,
    indentedLower: `FROM a\nRUN echo \\\n   add http://x/y /z\n`,
    bom: `﻿FROM a\n${URL_ADD}\n`,
    onbuild: `FROM a\nRUN echo \\\\\nONBUILD ${URL_ADD}\n`,
    copyFromInfra: `FROM a\nRUN echo \\\\\nCOPY --from=rl-infra/orchestrator:latest /etc /e\n`,
    stageAliasShadow: `FROM alpine AS rl-infra/orchestrator\nFROM a\nCOPY --from=rl-infra/orchestrator / /\n`,
  };
  for (const [k, df] of Object.entries(cases)) assert.notEqual(dockerfileReason(df), null, k);
});

test('ordinary Dockerfiles still pass', () => {
  const ok = 'FROM node:22-alpine AS deps\r\nRUN apk add --no-cache \\\r\n    git \\\r\n    # a comment\r\n    curl\r\nCOPY --from=deps /app /app\nADD files.tar.gz /srv/\n';
  assert.equal(dockerfileReason(ok), null);
});
