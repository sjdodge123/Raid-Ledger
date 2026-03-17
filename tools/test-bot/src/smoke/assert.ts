import type { SimpleEmbed, SimpleComponent } from '../helpers/messages.js';

export class SmokeAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmokeAssertionError';
  }
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

export function assertEmbedTitle(embed: SimpleEmbed, pattern: RegExp) {
  if (!embed.title || !pattern.test(embed.title)) {
    fail(`Expected embed title matching ${pattern}, got: "${embed.title}"`);
  }
}

export function assertEmbedDescription(embed: SimpleEmbed, pattern: RegExp) {
  if (!embed.description || !pattern.test(embed.description)) {
    fail(`Expected description matching ${pattern}, got: "${embed.description}"`);
  }
}

export function assertEmbedColor(embed: SimpleEmbed, expected: number) {
  if (embed.color !== expected) {
    const hex = (n: number | null) => (n !== null ? `#${n.toString(16)}` : 'null');
    fail(`Expected embed color ${hex(expected)}, got ${hex(embed.color)}`);
  }
}

export function assertEmbedHasField(embed: SimpleEmbed, name: RegExp) {
  const found = embed.fields.some((f) => name.test(f.name));
  if (!found) {
    const names = embed.fields.map((f) => f.name).join(', ');
    fail(`Expected field matching ${name}, found: [${names}]`);
  }
}

export function assertHasButton(
  components: SimpleComponent[],
  label: string,
) {
  const found = components.some(
    (c) => c.label === label || c.customId?.startsWith(label),
  );
  if (!found) {
    const labels = components.map((c) => c.label ?? c.customId).join(', ');
    fail(`Expected button "${label}", found: [${labels}]`);
  }
}

export function assertEmbedCount(
  embeds: SimpleEmbed[],
  min: number,
) {
  if (embeds.length < min) {
    fail(`Expected at least ${min} embed(s), got ${embeds.length}`);
  }
}
