/**
 * Lenient XML parsing spec (ROK-1397). Fixtures mirror real payloads
 * captured by the ROK-275 probe (Palworld PC entry; Cloudflare trailing
 * script; the literal empty envelope).
 */
import {
  parseCooptimusResponse,
  isEmptyEnvelope,
  sliceEnvelope,
} from './cooptimus-xml.util';

const PALWORLD = `<games>
<game>
<id>9814</id>
<title>Palworld</title>
<system>PC</system>
<steam>1623730</steam>
<genre>Simulation</genre>
<publisher>Pocket Pair</publisher>
<esrb>Teen</esrb>
<releasedate>2026-07-10</releasedate>
<local>0</local>
<online>32</online>
<lan>32</lan>
<splitscreen>0</splitscreen>
<dropindropout>1</dropindropout>
<campaign>1</campaign>
<modes>0</modes>
<featurelist>Drop-In/Drop-Out, Campaign Co-Op</featurelist>
<coopexp>Invite your friends &amp; go on an adventure together.</coopexp>
<background>Palworld is a multiplayer game.</background>
<url>https://www.co-optimus.com/game/9814/PC/palworld.html</url>
<art>https://www.co-optimus.com/cache/boxart/9814.jpg</art>
<thumbnail>https://www.co-optimus.com/cache/boxart/thumb.9814.jpg</thumbnail>
</game>
</games>

<script>(function(){var a=document.createElement('script');}())</script>`;

describe('cooptimus-xml.util (ROK-1397)', () => {
  it('parses a real entry and slices the trailing Cloudflare script', () => {
    const entries = parseCooptimusResponse(PALWORLD);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 9814,
      title: 'Palworld',
      system: 'PC',
      steam: 1623730,
      online: 32,
      local: 0,
      lan: 32,
      splitscreen: false,
      dropInDropOut: true,
      campaign: true,
      featurelist: 'Drop-In/Drop-Out, Campaign Co-Op',
      url: 'https://www.co-optimus.com/game/9814/PC/palworld.html',
    });
    // Entity decoding in prose fields.
    expect(entries[0].coopExperience).toContain('friends & go');
  });

  it('treats the literal empty envelope as a positive no-entry signal', () => {
    expect(isEmptyEnvelope('<games>\n</games>\n')).toBe(true);
    expect(isEmptyEnvelope(PALWORLD)).toBe(false);
    expect(parseCooptimusResponse('<games>\n</games>\n')).toHaveLength(0);
  });

  it('skips malformed blocks missing required tags instead of throwing', () => {
    const mangled = '<games><game><id>1</id></game></games>';
    expect(parseCooptimusResponse(mangled)).toHaveLength(0);
  });

  it('sliceEnvelope is a no-op when no envelope close exists', () => {
    expect(sliceEnvelope('garbage')).toBe('garbage');
  });

  it('multi-platform responses yield one entry per platform', () => {
    const two = PALWORLD.replace(
      '</games>',
      `<game><id>9815</id><title>Palworld</title><system>Xbox Series</system><online>4</online></game>\n</games>`,
    );
    const entries = parseCooptimusResponse(two);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      id: 9815,
      system: 'Xbox Series',
      steam: null,
      online: 4,
    });
  });
});
