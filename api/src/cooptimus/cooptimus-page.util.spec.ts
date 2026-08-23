import { parseGamePage } from './cooptimus-page.util';

/**
 * Fixtures mirror the STRUCTURE of a co-optimus.com game page (a <dl> of
 * dt/dd Core Features + a <ul id="coop-extras"> list) but are hand-authored —
 * we don't redistribute their markup or copy, per the ROK-275 grant.
 * The parser was separately validated against 17 real pages; see the util's
 * header for the measurements that motivated it.
 */
function page(opts: {
  combo?: string;
  extras?: string[];
  coreBlock?: boolean;
  extrasBlock?: boolean;
}) {
  const core =
    opts.coreBlock === false
      ? ''
      : `
    <div id="coop-features" class="large-6 columns"><h4>Core Features</h4><dl>
      <dt>Local Co-Op</dt><dd class="clearfix"><img src="x.png" /><em>2 Players </em></dd>
      <dt>Online Co-Op</dt><dd class="clearfix"><img src="x.png" /><em>4 Players</em></dd>
      ${opts.combo === undefined ? '' : `<dt>Combo Co-Op (Local + Online)</dt><dd class="clearfix"><img src="x.png" /><em>${opts.combo}</em></dd>`}
      <dt>LAN Play or System Link</dt><dd class="last clearfix"><img src="x.png" /><em>4 Players</em></dd>
    </dl></div>`;
  const extras =
    opts.extrasBlock === false
      ? ''
      : `
    <div id="coopExtras"><h4>Co-Op Extras</h4><ul id="coop-extras">
      ${(opts.extras ?? []).map((e) => `<li>${e}</li>`).join('')}
    </ul></div>`;
  return `<html><body>${core}${extras}</body></html>`;
}

describe('parseGamePage', () => {
  it('reads a supported combo row and keeps their exact wording', () => {
    // The Baldur's Gate III case that exposed the bug: the API payload carries
    // no combo element at all, so this can ONLY come from the page.
    const r = parseGamePage(page({ combo: 'Up to 4 Local or Online' }));
    expect(r.comboCoop).toBe(true);
    expect(r.comboLabel).toBe('Up to 4 Local or Online');
  });

  it('treats an explicit "Not Supported" as a reported false, not unknown', () => {
    // Portal 2 reports local=2 AND online=2 yet their page says Not Supported —
    // proof combo is editorial, not derivable from the counts.
    expect(parseGamePage(page({ combo: 'Not Supported' })).comboCoop).toBe(
      false,
    );
  });

  it.each([
    ['null input', null],
    ['unrelated html', '<html><body>nothing here</body></html>'],
    ['core block missing', page({ coreBlock: false })],
    ['combo row missing', page({})],
    ['combo value empty', page({ combo: '' })],
  ])('returns unknown (null) for %s — never a false claim', (_label, html) => {
    const r = parseGamePage(html);
    expect(r.comboCoop).toBeNull();
    expect(r.comboLabel).toBeNull();
  });

  it('detects Downloadable Only from the extras list', () => {
    const r = parseGamePage(
      page({
        combo: 'Not Supported',
        extras: ['Downloadable Only', 'Co-Op Campaign'],
      }),
    );
    expect(r.downloadableOnly).toBe(true);
  });

  it('reports false when extras are listed without Downloadable Only', () => {
    const r = parseGamePage(
      page({
        combo: 'Not Supported',
        extras: ['Co-Op Campaign', 'Drop In/Drop Out'],
      }),
    );
    expect(r.downloadableOnly).toBe(false);
  });

  it.each([
    [
      'extras block missing',
      page({ combo: 'Not Supported', extrasBlock: false }),
    ],
    ['extras list empty', page({ combo: 'Not Supported', extras: [] })],
  ])('returns unknown Downloadable Only for %s', (_label, html) => {
    expect(parseGamePage(html).downloadableOnly).toBeNull();
  });

  it('ignores markup and entities inside the value', () => {
    const r = parseGamePage(
      page({ combo: 'Up to 4 <b>Local</b>&nbsp;or Online' }),
    );
    expect(r.comboLabel).toBe('Up to 4 Local or Online');
  });
});
