// @ts-check
/**
 * Bans printf-style placeholders in Nest logger messages.
 *
 * Nest's Logger does NOT interpolate: `logger.warn('Signup %s failed', id)`
 * keeps the literal `%s` in the message and emits `id` as a separate message
 * line (or as the log context, on a context-less logger), so the value never
 * lands where the placeholder is. Build the message with a template literal
 * instead: `logger.warn(`Signup ${id} failed`)`.
 *
 * Matches `.log/.warn/.error/.debug/.verbose/.fatal` on any receiver whose
 * name ends in `logger`/`Logger` (`logger`, `Logger`, `this.logger`,
 * `deps.logger`) when the first argument is a string literal, a template
 * literal, or a `+` concatenation carrying `%s/%d/%i/%f/%o/%O/%j`.
 * `console.*` (which does interpolate) and jest `it.each` titles are not
 * logger calls and are never matched. Specs are excluded in the config.
 *
 * Pinned by scripts/api-eslint-no-printf-logger.spec.mjs.
 */

const METHOD = String.raw`/^(log|warn|error|debug|verbose|fatal)$/`;
const RECEIVER = String.raw`/[lL]ogger$/`;
const PLACEHOLDER = String.raw`/%[sdifoOj]/`;

const LOGGER_CALL =
  `CallExpression[callee.property.name=${METHOD}]` +
  `:matches([callee.object.name=${RECEIVER}], [callee.object.property.name=${RECEIVER}])`;

export const PRINTF_LOGGER_MESSAGE =
  'Nest Logger does not interpolate printf placeholders (%s/%d/...): the ' +
  'value is emitted as a separate message line (or as the context on a ' +
  'context-less logger) and the message keeps a literal %s. ' +
  'Use a template literal: logger.warn(`Signup ${id} failed`).';

/** `no-restricted-syntax` entries; spread them into the rule's options. */
export const noPrintfLoggerSyntax = [
  `${LOGGER_CALL}[arguments.0.type='Literal'][arguments.0.value=${PLACEHOLDER}]`,
  `${LOGGER_CALL} > TemplateLiteral.arguments:first-child > TemplateElement[value.raw=${PLACEHOLDER}]`,
  `${LOGGER_CALL} > BinaryExpression.arguments:first-child :matches(Literal[value=${PLACEHOLDER}], TemplateElement[value.raw=${PLACEHOLDER}])`,
].map((selector) => ({ selector, message: PRINTF_LOGGER_MESSAGE }));
