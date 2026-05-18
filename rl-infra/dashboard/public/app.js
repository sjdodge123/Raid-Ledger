// rl-fleet dashboard — fetches /api/state and renders cards. Auto-refreshes
// every 5s. Designed to be useful when SSH'd into nothing — just bookmarks
// fleet.rl.lan on the operator's phone.

const REFRESH_MS = 5000;

const $ = (id) => document.getElementById(id);
const el = (tag, opts = {}, ...children) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text) node.textContent = opts.text;
  if (opts.href) node.href = opts.href;
  if (opts.target) node.target = opts.target;
  if (opts.rel) node.rel = opts.rel;
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const ageS = Math.max(0, Math.floor((now - d.getTime()) / 1000));
    if (ageS < 60) return `${ageS}s ago`;
    if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
    if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`;
    return `${Math.floor(ageS / 86400)}d ago`;
  } catch {
    return iso;
  }
};

// isLan controls whether the LAN-only infra section (Traefik/Grafana/Registry)
// is shown. The slot web/debug links below are ALWAYS shown — operators
// often hit fleet.gamernight.net from a LAN phone where slot-N.rl.lan
// still resolves via Pi-hole. Off-LAN clicks will fail at DNS resolution
// (the slot hostnames have no public DNS), which is acceptable feedback.
const isLan = window.location.hostname.endsWith('.rl.lan');

const renderSlot = (s) => {
  const card = el('div', { class: 'card' });
  card.appendChild(
    el('div', { class: 'card-title' }, `Slot ${s.slot}`, ' ',
      el('span', { class: `badge ${s.claimed ? 'busy' : 'idle'}`, text: s.claimed ? 'busy' : 'idle' }),
    ),
  );
  if (s.claimed) {
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'agent' }),
      el('span', { class: 'val', text: s.agent_id || '—' }),
    ));
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'branch' }),
      el('span', { class: 'val', text: s.branch || '—' }),
    ));
    card.appendChild(el('div', { class: 'card-row' },
      el('span', { class: 'key', text: 'heartbeat' }),
      el('span', { class: 'val', text: fmtTime(s.last_heartbeat) }),
    ));
  }
  const actions = el('div', { class: 'actions' });
  // Server probes the runner's 5173 / 9229 ports on each /api/state call.
  // When the probe says "listening", render a real link. When down (the
  // common case — runner is a tmux shell until an agent runs `npm run dev`
  // or starts a Node process with --inspect), render a disabled span so
  // tapping doesn't surface a confusing 502 from Traefik.
  if (s.web_listening) {
    actions.appendChild(el('a', { href: `http://slot-${s.slot}.rl.lan`, target: '_blank', rel: 'noopener', text: 'web' }));
  } else {
    const span = el('span', { class: 'btn-disabled', text: 'web (idle)' });
    span.title = 'No dev server detected on this slot. Run `npm run dev -w web` inside the runner via `rl shell` to enable.';
    actions.appendChild(span);
  }
  if (s.debug_listening) {
    actions.appendChild(el('a', { href: `http://slot-${s.slot}-debug.rl.lan`, target: '_blank', rel: 'noopener', text: 'debug' }));
  } else {
    const span = el('span', { class: 'btn-disabled', text: 'debug (idle)' });
    span.title = 'No Node inspector detected on this slot (port 9229). Start a Node process with --inspect=0.0.0.0:9229 to enable.';
    actions.appendChild(span);
  }
  card.appendChild(actions);
  return card;
};

const renderEnv = (e, publicDomain) => {
  // Env shape from /api/state varies — it's whatever the orchestrator wrote.
  // We accept the env-registry.json shape: { slug, slot, image, ttl, created_at, last_touched, public_domain? }.
  const slug = e.slug;
  const internalUrl = `http://${slug}.rl.lan`;
  // Prefer the env's own recorded public_domain (in case it was spun under
  // a different RL_PUBLIC_DOMAIN), fall back to the server's current value.
  // Public hostname pattern is ${slug}test.${publicDomain} to avoid colliding
  // with real subdomains under a single-level wildcard.
  const envPublic = e.public_domain || publicDomain;
  const publicUrl = envPublic ? `https://${slug}test.${envPublic}` : null;

  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card-title' }, slug, ' ',
    el('span', { class: 'badge ready', text: 'live' }),
  ));
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'slot' }),
    el('span', { class: 'val', text: e.slot ?? '—' }),
  ));
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'ttl' }),
    el('span', { class: 'val', text: e.ttl ?? '—' }),
  ));
  card.appendChild(el('div', { class: 'card-row' },
    el('span', { class: 'key', text: 'touched' }),
    el('span', { class: 'val', text: fmtTime(e.last_touched) }),
  ));

  const actions = el('div', { class: 'actions' });
  // When public URL is available, it's the PRIMARY action — operator and
  // testers see the same URL, and Pi-hole short-circuits the LAN path so
  // there's no Cloudflare round-trip cost on home network. Internal URL
  // is kept as a small fallback for the rare CF/NPM-outage case.
  if (publicUrl) {
    const ext = el('a', { href: publicUrl, target: '_blank', rel: 'noopener', text: 'open' });
    // Long-press / right-click copies the URL for sharing with testers.
    ext.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      navigator.clipboard?.writeText(publicUrl).then(() => {
        ext.textContent = 'copied!';
        setTimeout(() => { ext.textContent = 'open'; }, 1200);
      });
    });
    actions.appendChild(ext);
    actions.appendChild(el('a', { class: 'secondary', href: internalUrl, target: '_blank', rel: 'noopener', text: 'lan' }));
  } else {
    actions.appendChild(el('a', { href: internalUrl, target: '_blank', rel: 'noopener', text: 'open' }));
  }
  card.appendChild(actions);
  return card;
};

const renderEmpty = (msg) => el('div', { class: 'empty', text: msg });

const render = (data) => {
  const slotsDiv = $('slots');
  slotsDiv.replaceChildren();
  for (const s of data.slots ?? []) slotsDiv.appendChild(renderSlot(s));
  if (!data.slots?.length) slotsDiv.appendChild(renderEmpty('No slots configured.'));

  const envsDiv = $('envs');
  envsDiv.replaceChildren();
  $('env-count').textContent = data.envs?.length ? `· ${data.envs.length}` : '';
  if (data.envs?.length) {
    for (const e of data.envs) envsDiv.appendChild(renderEnv(e, data.public_domain));
  } else {
    envsDiv.appendChild(renderEmpty('No test envs running. Use `rl env spin <slug>` from the operator shell or the rl_env_spin MCP tool.'));
  }

  $('generated-at').textContent = `updated ${fmtTime(data.generated_at)}`;
};

const setStatus = (state) => {
  const indicator = $('refresh-indicator');
  indicator.classList.remove('error', 'pulse');
  if (state === 'error') indicator.classList.add('error');
  else if (state === 'ok') {
    void indicator.offsetWidth; // restart animation
    indicator.classList.add('pulse');
  }
};

const tick = async () => {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    render(data);
    setStatus('ok');
  } catch (err) {
    setStatus('error');
    // eslint-disable-next-line no-console
    console.warn('fetch failed', err);
  }
};

// Infra cards (Traefik/Grafana/Registry) are LAN-only because those services
// aren't exposed externally for security. Show the section ONLY when the
// dashboard was loaded via the .rl.lan hostname.
if (isLan) {
  $('infra-section').style.display = '';
}

tick();
setInterval(tick, REFRESH_MS);
