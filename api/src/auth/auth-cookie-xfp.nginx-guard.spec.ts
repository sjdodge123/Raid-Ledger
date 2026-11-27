/**
 * ROK-2322 review MINOR-3: the auth cookies' Secure flag trusts
 * `X-Forwarded-Proto` from the all-in-one image's nginx hop. This guard reads
 * (never edits) `nginx/monolith.conf.template` and fails if a location that
 * proxies to the api stops forwarding the outer proxy's scheme — e.g. an edit
 * to `X-Forwarded-Proto $scheme`, which would report `http` behind TLS.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TEMPLATE = resolve(__dirname, '../../../nginx/monolith.conf.template');
const API_UPSTREAM = 'proxy_pass http://127.0.0.1:3000';
const XFP = /proxy_set_header\s+X-Forwarded-Proto\s+([^;]+);/g;
/**
 * Locations allowed to proxy to the api without the header. `/i/:code` sends
 * only crawlers to the invite OG-card HTML; it sets no cookie. (Pre-existing;
 * logged in TECH-DEBT-BACKLOG.md, ROK-2322.)
 */
const EXEMPT = ['location ~ ^/i/([^/]+)$ {'];

/** Each `location … { … }` block, braces matched (nested `if` included). */
function locationBlocks(conf: string): string[] {
  const blocks: string[] = [];
  const re = /^\s*location\b[^{]*\{/gm;
  for (let m = re.exec(conf); m; m = re.exec(conf)) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < conf.length; i++) {
      if (conf[i] === '{') depth++;
      if (conf[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    blocks.push(conf.slice(m.index, end));
  }
  return blocks;
}

describe('monolith nginx forwards X-Forwarded-Proto to the api (ROK-2322)', () => {
  const conf = readFileSync(TEMPLATE, 'utf8');

  it('$proxy_proto passes the outer proxy value through, $scheme only when absent', () => {
    const map =
      /map\s+\$http_x_forwarded_proto\s+\$proxy_proto\s*\{([^}]*)\}/.exec(conf);
    const body = (map?.[1] ?? '').replace(/\s+/g, ' ').trim();
    expect(body).toBe("default $http_x_forwarded_proto; '' $scheme;");
  });

  it('every location proxying to the api sets X-Forwarded-Proto $proxy_proto', () => {
    const apiBlocks = locationBlocks(conf).filter((b) =>
      b.includes(API_UPSTREAM),
    );
    expect(apiBlocks.length).toBeGreaterThan(0);
    const missing = apiBlocks
      .filter(
        (b) => !/proxy_set_header\s+X-Forwarded-Proto\s+\$proxy_proto;/.test(b),
      )
      .map((b) => b.split('\n')[0]?.trim())
      .filter((head) => head === undefined || !EXEMPT.includes(head));
    expect(missing).toEqual([]);
  });

  it('no X-Forwarded-Proto header is set from anything but $proxy_proto', () => {
    const values = [...conf.matchAll(XFP)].map((m) => m[1]?.trim());
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v !== '$proxy_proto')).toEqual([]);
  });
});
