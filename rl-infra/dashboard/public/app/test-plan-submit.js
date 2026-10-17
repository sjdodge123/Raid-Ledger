// ROK-1337 — Tester-page draft + submit handlers.
//
// Drafts are stored in localStorage keyed by (slug, plan_id) — independent
// per tab. Submit batches the entire draft via POST /api/test-plans/{slug}/
// {plan_id}/submit. Per the wireframe there are NO animations on submit;
// the page snap-renders against the post-submit state on the next render
// pass.

(function attachTesterSubmit() {
  const NS = (window.__rlTester = window.__rlTester || {});

  // Per-tab tester name. Stored in localStorage only — we deliberately
  // skip the cookie path the operator route uses because the tester page
  // is the operator's primary entry point and the operator's existing
  // cookie already populates this on first interaction.
  const TESTER_LS_KEY = 'rl-tester-name-v2';
  const sanitizeTester = (raw) =>
    (raw || '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 50).trim();

  const getStoredTesterName = () => {
    try {
      const cookie = document.cookie.split('; ').find((s) => s.startsWith('rl-tester-name='));
      if (cookie) return decodeURIComponent(cookie.split('=', 2)[1] || '');
    } catch { /* ignore */ }
    try { return localStorage.getItem(TESTER_LS_KEY) || ''; } catch { return ''; }
  };

  // In-page modal — replicates the operator route's ROK-1336 #4 fix
  // (window.prompt is unreliable on mobile Safari). Returns a Promise
  // resolving to the entered name or null on cancel.
  const askTesterNameModal = () => new Promise((resolve) => {
    document.querySelectorAll('.rl-modal-backdrop').forEach((n) => n.remove());
    const { el } = NS;
    const backdrop = el('div', { class: 'rl-modal-backdrop' });
    const modal = el('div', { class: 'rl-modal' });
    modal.appendChild(el('h3', { class: 'rl-modal-title', text: 'Your name' }));
    modal.appendChild(el('p', {
      class: 'rl-modal-sub',
      text: 'So the agent + operator can see who reported what. Saved on this device.',
    }));
    const input = document.createElement('input');
    input.className = 'rl-modal-input';
    input.type = 'text';
    input.placeholder = 'e.g. Jake, alice, mobile-tester';
    input.maxLength = 50;
    input.value = getStoredTesterName();
    modal.appendChild(input);
    const actions = el('div', { class: 'rl-modal-actions' });
    const cancelBtn = el('button', { class: 'btn-cancel', text: 'Cancel' });
    const saveBtn = el('button', { class: 'btn-submit', text: 'Save' });
    const close = (val) => { backdrop.remove(); resolve(val); };
    cancelBtn.addEventListener('click', () => close(null));
    saveBtn.addEventListener('click', () => {
      const cleaned = sanitizeTester(input.value);
      if (!cleaned) { input.focus(); return; }
      try { localStorage.setItem(TESTER_LS_KEY, cleaned); } catch {}
      close(cleaned);
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveBtn.click(); });
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(null); });
    actions.append(cancelBtn, saveBtn);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    setTimeout(() => input.focus(), 50);
  });

  const ensureTesterName = async () => {
    const stored = getStoredTesterName();
    if (stored) return stored;
    return askTesterNameModal();
  };

  // ----- Draft state -----
  const loadDraft = (slug, planId) => {
    try {
      const raw = localStorage.getItem(NS.draftKey(slug, planId));
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const saveDraft = (slug, planId, draft) => {
    try {
      if (Object.keys(draft).length === 0) {
        localStorage.removeItem(NS.draftKey(slug, planId));
      } else {
        localStorage.setItem(NS.draftKey(slug, planId), JSON.stringify(draft));
      }
    } catch { /* quota — degrade silently */ }
  };
  const clearDraft = (slug, planId) => {
    try { localStorage.removeItem(NS.draftKey(slug, planId)); } catch {}
  };
  const bufferVerdict = (slug, planId, stepId, verdict) => {
    const draft = loadDraft(slug, planId);
    if (draft[stepId] === verdict) delete draft[stepId];
    else draft[stepId] = verdict;
    saveDraft(slug, planId, draft);
    return draft;
  };

  // ----- POST helpers -----
  const submitDraft = async (slug, plan) => {
    const tester = await ensureTesterName();
    if (!tester) return { ok: false, cancelled: true };
    const draft = loadDraft(slug, plan.plan_id);
    const verdicts = Object.entries(draft).map(([stepId, verdict]) => ({
      step_id: parseInt(stepId, 10), verdict,
    }));
    if (verdicts.length === 0) return { ok: false, empty: true };
    const r = await fetch(`/api/test-plans/${encodeURIComponent(slug)}/${plan.plan_id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tester, verdicts }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: j.error || `HTTP ${r.status}` };
    }
    clearDraft(slug, plan.plan_id);
    return { ok: true };
  };

  const postComment = async (slug, plan, stepId, body, attachmentUrl) => {
    const tester = await ensureTesterName();
    if (!tester) return { ok: false, cancelled: true };
    const r = await fetch(
      `/api/test-plans/${encodeURIComponent(slug)}/${plan.plan_id}/step/${stepId}/comment`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tester, body, attachment_url: attachmentUrl || null }),
      },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: j.error || `HTTP ${r.status}` };
    }
    return { ok: true };
  };

  const requestReset = async (slug, plan, stepId) => {
    const tester = await ensureTesterName();
    if (!tester) return { ok: false, cancelled: true };
    const r = await fetch(
      `/api/test-plans/${encodeURIComponent(slug)}/${plan.plan_id}/step/${stepId}/reset-request`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tester }),
      },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: j.error || `HTTP ${r.status}` };
    }
    return { ok: true };
  };

  // Upload a screenshot. Returns the public URL on success (or null on
  // failure). Caller is expected to wire it into a comment via postComment.
  const uploadAttachment = async (slug, plan, file) => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const r = await fetch(
      `/api/test-plans/${encodeURIComponent(slug)}/${plan.plan_id}/attachment`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime: file.type, data: dataUrl }),
      },
    );
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return j.url || null;
  };

  Object.assign(NS, {
    sanitizeTester, getStoredTesterName, askTesterNameModal, ensureTesterName,
    loadDraft, saveDraft, clearDraft, bufferVerdict,
    submitDraft, postComment, requestReset, uploadAttachment,
  });
})();
