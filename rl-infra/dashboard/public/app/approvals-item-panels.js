// ROK-1900 — approvals item page: DOM kit + attachment panels.
//
// Plain <script> on window.__rlApprovals (load before approvals-item.js).
// Moved out of approvals-item.js to keep it under the 300-line limit; pure
// move, no behaviour change. Exposes NS.itemKit = { WIDTHS, h, btn,
// mockupFrame, makePanels(st, paint, contentUrl) }.

(function attachApprovalsItemKit() {
  const NS = (window.__rlApprovals = window.__rlApprovals || {});

  const WIDTHS = [['phone', 'Phone', 390], ['tablet', 'Tablet', 820], ['desktop', 'Desktop', 1280]];

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const btn = (label, cls, onClick) => {
    const b = h('button', `approval-btn ${cls || ''}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  // The one place the mockup iframe is built — attributes are the security
  // boundary (spec D5), so nothing else may add to them.
  const mockupFrame = (src) => {
    const f = document.createElement('iframe');
    f.className = 'approval-frame';
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Mockup (sandboxed — cannot reach the network or this page)');
    f.src = src;
    return f;
  };

  // Panels read the live page state `st` and repaint through `paint`.
  const makePanels = (st, paint, contentUrl) => {
      const mockupPanel = (item) => {
        const panel = h('div', 'approval-mockup');
        const src = contentUrl(item.attachments.mockup);
        if (!src) return panel;
        const bar = h('div', 'approval-frame-bar');
        const seg = h('div', 'approvals-seg approval-width-seg');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Mockup width');
        for (const [name, label, px] of WIDTHS) {
          const b = btn(label, name === st.width ? 'on' : '', () => { st.width = name; paint(); });
          b.className = name === st.width ? 'on' : '';
          b.dataset.width = String(px);
          b.setAttribute('aria-pressed', String(name === st.width));
          seg.append(b);
        }
        const full = h('a', 'approval-btn', 'Open full screen ↗');
        full.href = src;
        full.target = '_blank';
        full.rel = 'noopener noreferrer';
        full.referrerPolicy = 'no-referrer';
        bar.append(seg, full);
        // The frame gets the selected layout WIDTH (not a max): the column is
        // narrower than 1280 px, so a max-width made Tablet and Desktop render
        // alike. The viewport scrolls sideways instead (codex P2).
        const box = h('div', 'approval-frame-box');
        box.style.width = `${(WIDTHS.find((w) => w[0] === st.width) || WIDTHS[2])[2]}px`;
        box.append(mockupFrame(src));
        const viewport = h('div', 'approval-frame-viewport');
        viewport.append(box);
        panel.append(bar, h('span', 'approval-lock', "sandboxed · no network · can't see this page"), viewport);
        return panel;
      };

      const shotsStrip = (item) => {
        const strip = h('div', 'approval-shots');
        for (const s of item.attachments.screenshots) {
          const fig = h('button', 'approval-shot');
          fig.type = 'button';
          const src = contentUrl(s.file);
          if (!src) continue;
          const img = h('img');
          img.src = src;
          img.alt = s.caption || s.file;
          img.referrerPolicy = 'no-referrer';
          fig.append(img);
          if (s.caption) fig.append(h('span', 'approval-shot-cap', s.caption));
          fig.addEventListener('click', () => fig.classList.toggle('zoomed'));
          strip.append(fig);
        }
        return strip;
      };

      const specPanel = (item) => {
        const d = h('details', 'approval-spec');
        const name = (item.spec_path || '').split('/').pop() || 'spec.md';
        d.append(h('summary', null, `Spec — ${name}`));
        const md = h('div', 'approval-md');
        md.append(NS.renderMarkdown(st.spec, document));
        d.append(md);
        return d;
      };

    return { mockupPanel, shotsStrip, specPanel };
  };

  NS.itemKit = { WIDTHS, h, btn, mockupFrame, makePanels };
})();
