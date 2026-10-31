// The self-host compose snippet is read from README.md at build time (ruling
// Q12), so the site can never drift from the README's setup steps.
import readme from '../../../README.md?raw';

const SETUP_HEADING = '## Setup — the three required steps';

/** The first ```yaml block under the README's setup heading. */
export function composeYaml(src: string = readme): string {
  const start = src.indexOf(SETUP_HEADING);
  if (start < 0) throw new Error(`README.md: heading "${SETUP_HEADING}" not found`);
  const block = /```ya?ml\n([\s\S]*?)```/.exec(src.slice(start));
  if (!block?.[1]) throw new Error('README.md: no ```yaml block under the setup heading');
  return block[1].replace(/\s+$/, '');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightValue(key: string, value: string): string {
  const v = value.trim();
  if (!v) return esc(value);
  const lead = value.slice(0, value.indexOf(v));
  const isString = /^".*"$/.test(v) || key === 'image';
  return lead + (isString ? `<span class="s">${esc(v)}</span>` : esc(v));
}

/** Minimal YAML colouring for the terminal block: keys, strings, comments. */
function highlightLine(line: string): string {
  const hash = line.search(/\s#\s/);
  const code = hash < 0 ? line : line.slice(0, hash);
  const comment = hash < 0 ? '' : `<span class="c">${esc(line.slice(hash))}</span>`;
  const keyed = /^(\s*)([\w-]+):(.*)$/.exec(code);
  if (keyed) {
    const [, indent = '', key = '', rest = ''] = keyed;
    return `${indent}<span class="k">${esc(key)}</span>:${highlightValue(key, rest)}${comment}`;
  }
  const item = /^(\s*- )(.*)$/.exec(code);
  if (item) {
    const [, dash = '', rest = ''] = item;
    const trimmed = rest.replace(/\s+$/, '');
    const pad = rest.slice(trimmed.length);
    return `${esc(dash)}<span class="s">${esc(trimmed)}</span>${pad}${comment}`;
  }
  return esc(code) + comment;
}

export function composeHtml(yaml: string = composeYaml()): string {
  return yaml.split('\n').map(highlightLine).join('\n');
}
