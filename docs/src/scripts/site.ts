// Vanilla behaviour for the landing page: menu, reveal-on-scroll, the hero
// Discord embed and the compose Copy button. Theme handling is in theme.ts.
import { initTheme } from './theme';

function initMenu(): void {
  const nav = document.getElementById('nav');
  const btn = document.getElementById('menuBtn');
  if (!nav || !btn) return;
  const close = () => {
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('#mobileMenu a').forEach((a) => a.addEventListener('click', close));
}

function initReveal(): void {
  const els = document.querySelectorAll('.reveal');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  els.forEach((e) => io.observe(e));
}

const EMBED_MSG: Record<string, string> = {
  in: "You're in as a Healer · 32 of 40 signed up · reminder 1 hour before",
  maybe: "Marked tentative · you'll be moved up if a spot opens",
  out: "Got it, you're out this week · the host has been told",
};

function initEmbed(): void {
  const foot = document.getElementById('embedFoot');
  const count = document.querySelector('[data-count="heal"]');
  const bar = document.querySelector<HTMLElement>('[data-bar="heal"]');
  const btns = document.querySelectorAll<HTMLButtonElement>('.dbtn');
  if (!foot || !count || !bar) return;
  const idle = foot.textContent ?? '';
  let state: string | null = null;
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      state = state === b.dataset.act ? null : (b.dataset.act ?? null);
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.act === state)));
      const heal = 5 + (state === 'in' ? 1 : 0);
      count.textContent = String(heal);
      bar.style.width = `${Math.round((heal / 8) * 100)}%`;
      foot.textContent = state ? (EMBED_MSG[state] ?? idle) : idle;
    }),
  );
}

function initCopy(): void {
  const btn = document.getElementById('copyBtn');
  const code = document.getElementById('compose');
  if (!btn || !code) return;
  btn.addEventListener('click', () => {
    const done = (label: string) => () => {
      btn.textContent = label;
      window.setTimeout(() => (btn.textContent = 'Copy'), 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code.textContent ?? '').then(done('Copied'), done('Press ⌘C'));
    } else {
      done('Press ⌘C')();
    }
  });
}

initTheme();
initMenu();
initReveal();
initEmbed();
initCopy();
