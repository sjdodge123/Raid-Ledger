// ROK-1846 c1 — build ustar archives in memory for the build-context tests.
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);

function header(name, size, type) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 'latin1');
  h.write('0000000\0', 108, 'latin1');
  h.write('0000000\0', 116, 'latin1');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  h.write('00000000000\0', 136, 'latin1');
  h.fill(' ', 148, 156);
  h.write(type, 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

/** One PAX record `"<len> key=value\n"`. */
export function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len += 1;
  return `${len}${body}`;
}

/**
 * entries: [{ name, data = '', type = '0', size }] → a tar Buffer with the end
 * marker. `size` (default data length) is the DECLARED header size; the body
 * written is always `data`, so a body-less type can declare a size it lacks.
 */
export function tarOf(entries) {
  const parts = [];
  for (const { name, data = '', type = '0', size } of entries) {
    const d = Buffer.from(data);
    parts.push(header(name, size ?? d.length, type), d, pad(d.length));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
