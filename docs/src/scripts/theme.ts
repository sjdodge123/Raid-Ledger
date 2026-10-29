// Theme toggle: follows prefers-color-scheme until the visitor picks one,
// then remembers that choice. The first paint is set by the inline bootstrap
// in layouts/Base.astro; this wires the buttons and OS changes.
const KEY = 'rl-site-theme';
type Theme = 'dark' | 'light';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll<HTMLButtonElement>('.theme-toggle button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.set === theme));
  });
}

export function initTheme(): void {
  const current = document.documentElement.getAttribute('data-theme');
  apply(current === 'light' ? 'light' : 'dark');
  document.querySelectorAll<HTMLButtonElement>('.theme-toggle button').forEach((b) => {
    b.addEventListener('click', () => {
      const t: Theme = b.dataset.set === 'light' ? 'light' : 'dark';
      apply(t);
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* private mode / blocked storage: the choice lasts for this page only */
      }
    });
  });
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', (e) => {
    if (!stored()) apply(e.matches ? 'light' : 'dark');
  });
}
