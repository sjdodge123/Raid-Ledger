// ROK-1846 c3 — one more reading of a Dockerfile for dockerfile-policy.mjs: the
// instruction stream of `dockerfile-ast` (MIT, the parser behind the Dockerfile
// language server). It is an ADDITIONAL reading, never the only one: the policy
// refuses if ANY reading finds a remote/variable ADD or a disallowed COPY --from.
import { DockerfileParser } from 'dockerfile-ast';

/**
 * Each instruction as `KEYWORD arg arg …` (ONBUILD keeps its trigger inline, so
 * the policy's ONBUILD unwrapping applies). Argument values are the parser's
 * escape-processed words. A parser crash yields a line that is always refused.
 * @param {string} text
 * @returns {string[]}
 */
export function astReading(text) {
  try {
    return DockerfileParser.parse(String(text)).getInstructions().map((i) => {
      const args = i.getArguments().map((a) => a.getValue());
      return [i.getKeyword(), ...args].join(' ');
    });
  } catch {
    return ['ADD $DOCKERFILE_AST_PARSE_FAILED /x'];
  }
}
