/**
 * Self-test for assertEmbedRenderRules / assertMessageRenderRules (ROK-1466).
 *
 * tools/test-bot is not an npm workspace and ships no vitest, so these run
 * under plain `npx tsx` and need no Discord connection:
 *
 *   cd tools/test-bot && npm run test:render-rules
 *
 * Every case is a pair — one embed that must pass and one that must fail — so
 * a rule that silently stops matching is caught rather than reading as green.
 */
import {
  SmokeAssertionError,
  assertEmbedRenderRules,
  assertMessageRenderRules,
  sweepRenderRules,
} from './assert.js';
import type { SimpleEmbed, SimpleMessage } from '../helpers/messages.js';

let failures = 0;

/** A minimal SimpleMessage wrapper for the message-level rules. */
function message(embeds: SimpleEmbed[]): SimpleMessage {
  return {
    id: '1', authorId: '2', authorTag: 'bot#0', content: '',
    embeds, components: [], timestamp: new Date(), editedAt: null,
  };
}

function embed(over: Partial<SimpleEmbed> = {}): SimpleEmbed {
  return {
    title: 'Raid Night',
    author: 'GAMER NIGHT',
    description: 'Some description',
    color: 0x5865f2,
    fields: [{ name: 'Roster', value: 'Bo, Ada', inline: false }],
    footer: 'raid-ledger',
    thumbnail: null,
    timestamp: null,
    ...over,
  };
}

/** Assert the embed passes every render rule. */
function ok(label: string, e: SimpleEmbed): void {
  try {
    assertEmbedRenderRules(e);
  } catch (err) {
    failures++;
    console.log(`FAIL ${label}: expected pass, threw "${String(err)}"`);
  }
}

/** Assert the embed trips a render rule, and that the message names it. */
function bad(label: string, e: SimpleEmbed, expect: RegExp): void {
  try {
    assertEmbedRenderRules(e);
    failures++;
    console.log(`FAIL ${label}: expected a SmokeAssertionError, got none`);
  } catch (err) {
    if (!(err instanceof SmokeAssertionError)) {
      failures++;
      console.log(`FAIL ${label}: wrong error type ${String(err)}`);
    } else if (!expect.test(err.message)) {
      failures++;
      console.log(`FAIL ${label}: message "${err.message}" !~ ${expect}`);
    }
  }
}

// ── the baseline must pass, or every "bad" case below is meaningless ────────
ok('clean embed', embed());

// ── raw Discord tokens in the unrendered chrome slots ───────────────────────
bad('timestamp token in author', embed({ author: 'STARTS <t:0:R>' }), /author/i);
bad('timestamp token in footer', embed({ footer: 'at <t:1700000000:f>' }), /footer/i);
bad('timestamp token in title', embed({ title: 'Raid <t:0:R>' }), /title/i);
bad('user mention in author', embed({ author: 'by <@123>' }), /author/i);
bad('role mention in footer', embed({ footer: '<@&99>' }), /footer/i);
bad('channel mention in title', embed({ title: 'in <#42>' }), /title/i);
bad('masked link in author', embed({ author: '[Open](https://x)' }), /author/i);
bad('masked link in footer', embed({ footer: '[Open](https://x)' }), /footer/i);
bad('masked link in title', embed({ title: '[Open](https://x)' }), /title/i);
bad('bold markdown in author', embed({ author: '**GAMER NIGHT**' }), /author/i);
bad('strike markdown in footer', embed({ footer: '~~raid-ledger~~' }), /footer/i);
bad('code markdown in author', embed({ author: '`GAMER NIGHT`' }), /author/i);

// ROK-1460 carve-out: the CANCELLED card strikes its TITLE through on purpose
// (isCancelledCard asserts title.startsWith('~~')). Discord renders markdown in
// embed titles but not in author/footer, so markdown is legal here only.
ok('struck-through title (ROK-1460 cancelled card)', embed({ title: '~~Raid Night~~' }));
ok('bold in description', embed({ description: '**Bo**\n**Ada**' }));
ok('timestamp token in description', embed({ description: 'Starts <t:0:R>' }));

// ── Discord API length limits ───────────────────────────────────────────────
ok('title at the 256 limit', embed({ title: 'x'.repeat(256) }));
bad('title over 256', embed({ title: 'x'.repeat(257) }), /title/i);
ok('description at the 4096 limit', embed({ description: 'x'.repeat(4096) }));
bad('description over 4096', embed({ description: 'x'.repeat(4097) }), /description/i);
ok('field value at the 1024 limit', embed({ fields: [{ name: 'F', value: 'x'.repeat(1024), inline: false }] }));
bad('field value over 1024', embed({ fields: [{ name: 'F', value: 'x'.repeat(1025), inline: false }] }), /field/i);
bad('empty field value', embed({ fields: [{ name: 'F', value: '', inline: false }] }), /field/i);
bad('whitespace-only field value', embed({ fields: [{ name: 'F', value: '   ', inline: false }] }), /field/i);
bad('empty field name', embed({ fields: [{ name: '', value: 'v', inline: false }] }), /field/i);
ok('25 fields', embed({ fields: Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, value: 'v', inline: false })) }));
bad('26 fields', embed({ fields: Array.from({ length: 26 }, (_, i) => ({ name: `f${i}`, value: 'v', inline: false })) }), /field/i);

// ── null chrome slots are legal (not every embed has an author/footer) ──────
ok('null author/footer/title', embed({ author: null, footer: null, title: null, description: 'x' }));

// ── message-level: ≤ 10 embeds ──────────────────────────────────────────────
try {
  assertMessageRenderRules(message(Array.from({ length: 10 }, () => embed())));
} catch (err) {
  failures++;
  console.log(`FAIL 10 embeds: expected pass, threw "${String(err)}"`);
}
try {
  assertMessageRenderRules(message(Array.from({ length: 11 }, () => embed())));
  failures++;
  console.log('FAIL 11 embeds: expected a SmokeAssertionError, got none');
} catch (err) {
  if (!(err instanceof SmokeAssertionError)) {
    failures++;
    console.log(`FAIL 11 embeds: wrong error type ${String(err)}`);
  }
}
try {
  assertMessageRenderRules(message([embed({ author: '<t:0:R>' })]));
  failures++;
  console.log('FAIL message sweeps embeds: expected a SmokeAssertionError, got none');
} catch {
  /* expected — the message-level sweep must reach each embed */
}

// ── the wiring seam: what pollForEmbed / waitForEmbedUpdate / waitForDM /
// waitForMessage actually call on a matched message. Planting <t:0:R> in an
// author line is the revert-verification for this story: remove the sweep from
// polling.ts and this case stops failing.
try {
  sweepRenderRules(message([embed({ author: 'STARTS <t:0:R>' })]));
  failures++;
  console.log('FAIL sweep catches a planted <t:0:R> author: expected a throw');
} catch (err) {
  if (!(err instanceof SmokeAssertionError) || !/author/i.test(err.message)) {
    failures++;
    console.log(`FAIL sweep error shape: ${String(err)}`);
  }
}

try {
  const planted = message([embed({ author: 'STARTS <t:0:R>' })]);
  const out = sweepRenderRules(planted, { skipRenderRules: true });
  if (out !== planted) {
    failures++;
    console.log('FAIL opt-out must return the same message untouched');
  }
} catch (err) {
  failures++;
  console.log(`FAIL skipRenderRules opt-out threw: ${String(err)}`);
}

try {
  const clean = message([embed()]);
  if (sweepRenderRules(clean) !== clean) {
    failures++;
    console.log('FAIL sweep must pass a clean message through unchanged');
  }
} catch (err) {
  failures++;
  console.log(`FAIL sweep rejected a clean message: ${String(err)}`);
}

console.log(
  failures === 0
    ? 'render-rules.selftest: all cases passed'
    : `render-rules.selftest: ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
