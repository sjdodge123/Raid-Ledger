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
  actions.appendChild(el('a', { href: `http://slot-${s.slot}.rl.lan`, target: '_blank', rel: 'noopener', text: 'web' }));
  actions.appendChild(el('a', { href: `http://slot-${s.slot}-debug.rl.lan`, target: '_blank', rel: 'noopener', text: 'debug' }));
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
  actions.appendChild(el('a', { href: internalUrl, target: '_blank', rel: 'noopener', text: 'internal' }));
  if (publicUrl) {
    const ext = el('a', { href: publicUrl, target: '_blank', rel: 'noopener', text: 'external (share)' });
    // Long-press / right-click copies the public URL for sharing with testers.
    ext.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      navigator.clipboard?.writeText(publicUrl).then(() => {
        ext.textContent = 'copied!';
        setTimeout(() => { ext.textContent = 'external (share)'; }, 1200);
      });
    });
    actions.appendChild(ext);
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

tick();
setInterval(tick, REFRESH_MS);
