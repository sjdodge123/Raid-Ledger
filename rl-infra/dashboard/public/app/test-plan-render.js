// ROK-1337 — Tester-page DOM construction. Pure-function-ish: takes a
// derived state object + a small `callbacks` bag, returns DOM. No fetch,
// no global state writes — the polling layer drives re-renders.
//
// Lives on window.__rlTester. Loaded after test-plan-state.js so it can
// borrow the pure helpers.

(function attachTesterRender() {
  const NS = (window.__rlTester = window.__rlTester || {});

  // Tiny DOM helper. Mirrors the operator-route `el()` but stays local so
  // the two modules don't share lexical scope. ALWAYS forces button type
  // to 'button' (HTML defaults to 'submit' which can fire implicit form
  // submits — bit us before on the operator route, codified here).
  const el = (tag, opts = {}, ...children) => {
    const node = document.createElement(tag);
    if (tag === 'button') node.type = 'button';
    if (opts.class) node.className = opts.class;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.href) node.href = opts.href;
    if (opts.target) node.target = opts.target;
    if (opts.rel) node.rel = opts.rel;
    if (opts.title) node.title = opts.title;
    if (opts.id) node.id = opts.id;
    if (opts.hidden) node.hidden = true;
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  };

  const fmtAgo = (iso) => {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const ageS = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (ageS < 60) return `${ageS}s ago`;
    if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
    if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`;
    return `${Math.floor(ageS / 86400)}d ago`;
  };

  // Story chip — Linear deep-link. Story IDs are validated server-side to
  // /^ROK-\d+$/ so we can safely interpolate.
  const renderStoryChip = (storyId) => {
    const href = `https://linear.app/roknua-projects/issue/${storyId}`;
    return el('a', {
      class: 'story-chip',
      href, target: '_blank', rel: 'noopener noreferrer',
      title: `Open ${storyId} in Linear`,
    }, `${storyId} ↗`);
  };

  const PILL_ICONS = {
    pending: '⚠', slate: '⏳', green: '🎉', gray: '🌙', refresh: '⚠',
  };
  const PILL_CLASSES = {
    pending: 'pill-amber', slate: 'pill-slate', green: 'pill-green',
    gray: 'pill-gray', refresh: 'pill-refresh',
  };

  const renderStatusPill = (state, onRefresh) => {
    const pill = el('div', { class: `pill ${PILL_CLASSES[state.kind] || 'pill-gray'}` });
    pill.appendChild(el('span', { class: 'ico', text: PILL_ICONS[state.kind] || '🌙' }));
    pill.appendChild(el('span', { text: state.label }));
    if (state.showRefresh) {
      const btn = el('button', { class: 'refresh', text: 'refresh ↻' });
      btn.addEventListener('click', () => { if (onRefresh) onRefresh(); });
      pill.appendChild(btn);
    }
    return pill;
  };

  // Step row — verdicts + drawer toggle. Drawer state is per-step and
  // PURELY in the DOM (open class on the step root). No animations.
  const renderStep = (plan, step, draft, callbacks) => {
    const row = el('div', { class: 'step' });
    row.dataset.stepId = String(step.id);

    const head = el('div', { class: 'step-head' });
    head.appendChild(el('span', { class: 'step-n', text: `${step.id}.` }));

    const body = el('div', { class: 'step-body' });
    body.appendChild(el('div', { class: 'step-desc', text: step.description || '' }));
    if (step.expected) {
      body.appendChild(el('div', { class: 'step-expected', text: `Expected: ${step.expected}` }));
    }
    // ROK-1337 follow-up — the test URL is the primary CTA for each step,
    // promoted to a full-width labeled button right under the description.
    // Live INSIDE step-body so it sits between the expected line and the
    // verdict row, not jammed into the right-side action cluster.
    if (step.test_url) {
      const link = el('a', {
        class: 'step-link', href: step.test_url,
        target: '_blank', rel: 'noopener noreferrer',
      }, '↗ Open test URL');
      body.appendChild(link);
    }
    head.appendChild(body);

    const actions = el('div', { class: 'step-actions' });
    const draftVerdict = draft && draft[step.id];
    const serverVerdict = (step.results || []).slice(-1)[0]?.verdict;
    const effective = draftVerdict || serverVerdict;
    const isPendingReset = (step.reset_requests || []).some((r) => r.status === 'pending');
    const isLocked = !!serverVerdict || isPendingReset;
    const mkVerdictBtn = (kind, glyph) => {
      const b = el('span', {
        class: `verdict ${kind}${effective === kind ? ' active' : ''}`,
        title: kind,
        text: glyph,
      });
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', isLocked ? '-1' : '0');
      if (isLocked) {
        b.setAttribute('aria-disabled', 'true');
        b.title = isPendingReset
          ? 'Reset requested — wait for the agent.'
          : 'This step has a server verdict; reset to re-vote.';
      } else {
        const onPick = () => callbacks.onVerdict?.(plan, step.id, kind);
        b.addEventListener('click', onPick);
        b.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(); }
        });
      }
      return b;
    };
    actions.appendChild(mkVerdictBtn('pass', '✓'));
    actions.appendChild(mkVerdictBtn('fail', '✗'));
    actions.appendChild(mkVerdictBtn('skip', '⤳'));
    const toggle = el('button', { class: 'step-toggle', text: '▾', title: 'Open' });
    toggle.setAttribute('aria-expanded', 'false');
    actions.appendChild(toggle);
    head.appendChild(actions);
    row.appendChild(head);

    // Drawer — built once, hidden until toggle. Contains: comment textarea,
    // attachment row, reset row (if reset_hint). test_url moved up to the
    // step head so it's tappable without expanding.
    const drawer = renderDrawer(plan, step, callbacks);
    drawer.hidden = true;
    row.appendChild(drawer);
    const setOpen = (open) => {
      drawer.hidden = !open;
      toggle.textContent = open ? '▴' : '▾';
      toggle.title = open ? 'Close' : 'Open';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      row.classList.toggle('open', open);
    };
    const toggleOpen = () => setOpen(drawer.hidden);
    toggle.addEventListener('click', (ev) => { ev.stopPropagation(); toggleOpen(); });
    // ROK-1337 follow-up — row-click expand. Bail if the click landed on
    // a verdict, the link, the toggle, or any nested control (button, a,
    // input, textarea, label). Without this guard, the verdict tap would
    // double-fire (vote + expand) and the drawer's textarea would lose
    // focus on every typed click.
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('a, button, input, textarea, label, .verdict')) return;
      toggleOpen();
    });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.addEventListener('keydown', (ev) => {
      if (ev.target !== row) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleOpen(); }
    });
    return row;
  };

  const renderDrawer = (plan, step, callbacks) => {
    const d = el('div', { class: 'drawer' });
    // test_url moved to the collapsed step head (see renderStep) so testers
    // can open it without expanding the drawer.
    const commentBlock = el('div');
    commentBlock.appendChild(el('div', { class: 'drawer-label', text: 'Comment (optional)' }));
    const ta = el('textarea', { class: 'drawer-textarea' });
    ta.placeholder = 'Note what you saw…';
    ta.maxLength = 2000;
    commentBlock.appendChild(ta);
    const attachRow = el('div', { class: 'attach-row' });
    const attachBtn = el('button', { class: 'attach-btn', text: '📎 Attach screenshot' });
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.style.display = 'none';
    attachBtn.addEventListener('click', () => fileInput.click());
    const pickedAttachments = [];
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      const thumb = el('span', { class: 'thumb', text: '…' });
      attachRow.appendChild(thumb);
      try {
        const url = await callbacks.onAttach?.(plan, f);
        if (url) {
          thumb.replaceChildren();
          const img = document.createElement('img');
          img.alt = 'screenshot preview';
          img.src = url;
          thumb.appendChild(img);
          pickedAttachments.push(url);
          // Codex P2 follow-up — capture the typed note BEFORE the
          // post-attach refresh blows away ta.value. Common flow is
          // "type a note, then attach a screenshot, hit send" — passing
          // the body along with the attach makes that one comment
          // instead of silently dropping the note. Clear the textarea
          // so the operator-facing Send button doesn't re-post it.
          const body = ta.value.trim();
          ta.value = '';
          await callbacks.onComment?.(plan, step.id, body, url);
        } else {
          thumb.textContent = 'fail';
        }
      } catch {
        thumb.textContent = 'err';
      }
    });
    attachRow.appendChild(attachBtn);
    attachRow.appendChild(fileInput);
    // Render any existing comment thumbnails so testers can see what's
    // already there. We mount thumbs OUTSIDE the live pickedAttachments
    // list (they're server-side already).
    for (const c of step.comments || []) {
      if (c.attachment_url) {
        const t = el('span', { class: 'thumb' });
        const img = document.createElement('img');
        img.alt = 'previous attachment';
        img.src = c.attachment_url;
        t.appendChild(img);
        attachRow.appendChild(t);
      }
    }
    commentBlock.appendChild(attachRow);
    const sendBtn = el('button', { class: 'submit-btn', text: 'Send comment' });
    sendBtn.style.marginTop = '8px';
    sendBtn.addEventListener('click', async () => {
      const body = ta.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        await callbacks.onComment?.(plan, step.id, body, null);
        ta.value = '';
      } finally {
        sendBtn.disabled = false;
      }
    });
    commentBlock.appendChild(sendBtn);
    d.appendChild(commentBlock);
    if (step.reset_hint) {
      const reset = el('div', { class: 'reset-row' });
      const btn = el('button', { class: 'reset-btn', text: '↻ Reset' });
      btn.title = step.reset_hint;
      btn.addEventListener('click', () => callbacks.onReset?.(plan, step.id));
      const isPendingReset = (step.reset_requests || []).some((r) => r.status === 'pending');
      if (isPendingReset) { btn.disabled = true; btn.title = 'Reset already requested — waiting on agent.'; }
      reset.appendChild(btn);
      reset.appendChild(el('span', { class: 'reset-hint', text: step.reset_hint }));
      d.appendChild(reset);
    }
    return d;
  };

  // NOW section — single plan, full step list, submit footer.
  const renderNowSection = (plan, draft, callbacks) => {
    const sec = el('div');
    sec.appendChild(el('div', { class: 'sec-label', text: 'Now' }));
    if (!plan) return sec;
    const card = el('div', { class: 'card card-now' });
    card.dataset.planId = plan.plan_id;
    const head = el('div', { class: 'card-head' });
    if (plan.story_id) head.appendChild(renderStoryChip(plan.story_id));
    head.appendChild(el('h3', { class: 'goal', text: plan.goal || '' }));
    card.appendChild(head);
    const meta = el('div', { class: 'card-meta' });
    const ago = fmtAgo(plan.created_at);
    meta.textContent = ago ? `Created ${ago}` : '';
    card.appendChild(meta);
    for (const step of plan.steps || []) {
      card.appendChild(renderStep(plan, step, draft, callbacks));
    }
    card.appendChild(renderSubmitBar(plan, draft, callbacks));
    sec.appendChild(card);
    return sec;
  };

  const renderSubmitBar = (plan, draft, callbacks) => {
    const bar = el('div', { class: 'submit-bar' });
    const draftCount = Object.keys(draft || {}).length;
    const totalSteps = (plan.steps || []).length;
    const pending = (plan.steps || []).filter((s) =>
      !(s.results || []).length && !(draft && draft[s.id])
    ).length;
    const label = el('div', { class: 'label' });
    if (draftCount === 0) {
      label.textContent = 'Tap pass / fail / skip on a step to start.';
    } else {
      label.appendChild(el('strong', { text: String(draftCount) }));
      label.appendChild(document.createTextNode(` verdict${draftCount === 1 ? '' : 's'} ready · ${pending} pending`));
    }
    const btn = el('button', { class: 'submit-btn', text: `Submit ${draftCount || ''}`.trim() });
    btn.disabled = draftCount === 0;
    btn.addEventListener('click', () => callbacks.onSubmit?.(plan));
    bar.appendChild(label);
    bar.appendChild(btn);
    return bar;
  };

  // ALSO ACTIVE — compact cards, dot-row, tap-to-promote.
  const renderAlsoSection = (plans, callbacks) => {
    const sec = el('div');
    if (!plans || plans.length === 0) return sec;
    sec.appendChild(el('div', { class: 'sec-label', text: 'Also active' }));
    for (const plan of plans) {
      sec.appendChild(renderAlsoCard(plan, callbacks));
    }
    return sec;
  };

  const renderAlsoCard = (plan, callbacks) => {
    const card = el('div', { class: 'card card-also' });
    card.dataset.planId = plan.plan_id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    const head = el('div', { class: 'card-head' });
    if (plan.story_id) head.appendChild(renderStoryChip(plan.story_id));
    head.appendChild(el('h3', { class: 'goal', text: plan.goal || '' }));
    card.appendChild(head);
    card.appendChild(el('div', { class: 'card-meta', text: fmtAgo(plan.created_at) ? `Created ${fmtAgo(plan.created_at)}` : '' }));
    const dotRow = el('div', { class: 'dot-row' });
    let verdicted = 0;
    for (const step of plan.steps || []) {
      const last = (step.results || []).slice(-1)[0];
      const cls = last ? `dot ${last.verdict}` : 'dot';
      dotRow.appendChild(el('span', { class: cls }));
      if (last) verdicted += 1;
    }
    dotRow.appendChild(el('span', {
      class: 'dot-meta',
      text: `${verdicted} / ${(plan.steps || []).length} verdicted`,
    }));
    card.appendChild(dotRow);
    card.appendChild(el('div', { class: 'tap-hint', text: '▸ Tap to focus this plan' }));
    const promote = () => {
      // Don't fire the promotion handler when the click landed on the
      // story-chip — that's a Linear deep-link, the tester is navigating
      // away intentionally.
      callbacks.onPromote?.(plan);
    };
    card.addEventListener('click', (ev) => {
      if (ev.target instanceof HTMLAnchorElement) return;
      promote();
    });
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); promote(); }
    });
    return card;
  };

  // DONE TODAY — collapsed by default; expander reveals all rows.
  const renderDoneSection = (plans, callbacks) => {
    const sec = el('div', { class: 'done-section' });
    if (!plans || plans.length === 0) return sec;
    const header = el('button', { class: 'done-header' });
    header.setAttribute('aria-expanded', 'false');
    const chev = el('span', { class: 'chev', text: '▸' });
    header.appendChild(chev);
    header.appendChild(el('span', { text: `Done today (${plans.length})` }));
    sec.appendChild(header);
    const list = el('div', { class: 'done-list' });
    list.hidden = true;
    const COLLAPSED_CAP = 2;
    const initial = plans.slice(0, COLLAPSED_CAP);
    const rest = plans.slice(COLLAPSED_CAP);
    initial.forEach((p) => list.appendChild(renderDoneRow(p)));
    if (rest.length > 0) {
      const showMore = el('button', { class: 'show-more', text: `▸ Show all ${rest.length} more` });
      showMore.addEventListener('click', () => {
        rest.forEach((p) => list.insertBefore(renderDoneRow(p), showMore));
        showMore.remove();
      });
      list.appendChild(showMore);
    }
    sec.appendChild(list);
    header.addEventListener('click', () => {
      const expanded = list.hidden;
      list.hidden = !expanded;
      chev.textContent = expanded ? '▾' : '▸';
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    return sec;
  };

  const renderDoneRow = (plan) => {
    const row = el('div', { class: 'done-row' });
    row.dataset.planId = plan.plan_id;
    if (plan.story_id) row.appendChild(renderStoryChip(plan.story_id));
    const summary = NS.summarize(plan);
    const status = summary.fail > 0
      ? el('span', { class: 'status-fail', text: '✗' })
      : el('span', { class: 'status-ok', text: '✓' });
    row.appendChild(status);
    row.appendChild(el('span', { text: plan.goal || '' }));
    row.appendChild(el('span', {
      class: 'counts',
      text: `${summary.pass} / ${summary.fail} / ${summary.skip}`,
    }));
    const lastTs = plan.submissions?.slice(-1)[0]?.ts || plan.created_at;
    row.appendChild(el('span', { class: 'when', text: fmtAgo(lastTs) }));
    return row;
  };

  Object.assign(NS, {
    el, renderStoryChip, renderStatusPill,
    renderStep, renderDrawer,
    renderNowSection, renderSubmitBar,
    renderAlsoSection, renderAlsoCard,
    renderDoneSection, renderDoneRow,
  });
})();
