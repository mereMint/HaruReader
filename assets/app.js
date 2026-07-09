(() => {
  const MANIFEST_URL = 'content-manifest.json';
  const STORAGE = {
    progress: 'harureader.progress.v1',
    last: 'harureader.last.v1',
    theme: 'harureader.theme.v1',
    speed: 'harureader.speed.v1'
  };

  const state = {
    manifest: [],
    activeFilter: 'all',
    search: '',
    current: null,
    currentHtml: '',
    typeTimer: null,
    restoring: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    views: $$('[data-view]'),
    nav: $$('[data-nav]'),
    libraryGrid: $('#libraryGrid'),
    emptyState: $('#emptyState'),
    searchInput: $('#searchInput'),
    themeToggle: $('#themeToggle'),
    continueButton: $('#continueButton'),
    homeLastTitle: $('#homeLastTitle'),
    homeLastMeta: $('#homeLastMeta'),
    homeProgressBar: $('#homeProgressBar'),
    readerKind: $('#readerKind'),
    readerTitle: $('#readerTitle'),
    readerMeta: $('#readerMeta'),
    readerProgressBar: $('#readerProgressBar'),
    readerContent: $('#readerContent'),
    readerArticle: $('#readerArticle'),
    playTypewriter: $('#playTypewriter'),
    showInstant: $('#showInstant'),
    speedSlider: $('#speedSlider')
  };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function slugFromPath(path) { return path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function getProgressMap() { return readJson(STORAGE.progress, {}); }
  function getProgress(id) { return getProgressMap()[id] || { percent: 0, scroll: 0, updatedAt: null }; }
  function setProgress(id, patch) {
    const map = getProgressMap();
    map[id] = { ...map[id], ...patch, updatedAt: new Date().toISOString() };
    writeJson(STORAGE.progress, map);
  }

  function escapeHtml(value = '') {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function inlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function markdownToHtml(markdown) {
    const normalized = markdown.replace(/^---[\s\S]*?---\s*/, '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const html = [];
    let paragraph = [];
    let list = null;
    let inCode = false;
    let code = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      html.push(`</${list}>`);
      list = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
          code = [];
          inCode = false;
        } else {
          flushParagraph(); closeList(); inCode = true;
        }
        continue;
      }
      if (inCode) { code.push(rawLine); continue; }

      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      if (/^---+$/.test(line.trim())) { flushParagraph(); closeList(); html.push('<hr>'); continue; }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(3, heading[1].length);
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      const quote = /^>\s?(.*)$/.exec(line);
      if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }

      const unordered = /^[-*]\s+(.*)$/.exec(line.trim());
      const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
      if (unordered || ordered) {
        flushParagraph();
        const desired = unordered ? 'ul' : 'ol';
        if (list !== desired) { closeList(); list = desired; html.push(`<${list}>`); }
        html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
        continue;
      }

      paragraph.push(line.trim());
    }

    flushParagraph(); closeList();
    if (inCode) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    return html.join('\n') || '<p class="muted">This file is empty.</p>';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    els.themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
    localStorage.setItem(STORAGE.theme, theme);
  }

  function route() {
    const hash = location.hash.replace(/^#/, '') || 'home';
    const [view, id] = hash.split('/');
    showView(view || 'home');
    if (view === 'reader' && id) openWork(id);
    if (view === 'library') renderLibrary();
  }

  function showView(name) {
    const legal = ['home', 'library', 'reader'];
    const active = legal.includes(name) ? name : 'home';
    els.views.forEach((view) => { view.hidden = view.dataset.view !== active; });
    els.nav.forEach((nav) => nav.classList.toggle('active', nav.dataset.nav === active));
    if (active === 'home') updateHomeStatus();
  }

  function updateHomeStatus() {
    const last = readJson(STORAGE.last, null);
    const item = last && state.manifest.find((entry) => entry.id === last.id);
    if (!item) {
      els.homeLastTitle.textContent = 'Nothing started yet';
      els.homeLastMeta.textContent = 'Progress is stored locally with localStorage.';
      els.homeProgressBar.style.width = '0%';
      return;
    }
    const progress = getProgress(item.id);
    els.homeLastTitle.textContent = item.title;
    els.homeLastMeta.textContent = `${labelFor(item)} · ${Math.round(progress.percent || 0)}% saved`;
    els.homeProgressBar.style.width = `${Math.min(100, progress.percent || 0)}%`;
  }

  function labelFor(item) {
    if (item.kind === 'novel') return item.volume ? `Novel · ${item.volume}` : 'Novel';
    return 'Skit';
  }

  function renderLibrary() {
    const query = state.search.trim().toLowerCase();
    const items = state.manifest.filter((item) => {
      const typeMatch = state.activeFilter === 'all' || item.kind === state.activeFilter;
      const haystack = `${item.title} ${item.folder} ${item.excerpt} ${item.kind}`.toLowerCase();
      return typeMatch && (!query || haystack.includes(query));
    });

    els.libraryGrid.innerHTML = items.map((item) => {
      const progress = getProgress(item.id);
      const percent = Math.round(progress.percent || 0);
      return `<a class="work-card" href="#reader/${item.id}" aria-label="Read ${escapeHtml(item.title)}">
        <div class="card-top">
          <span class="badge">${escapeHtml(labelFor(item))}</span>
          <span class="progress-chip">${percent ? `${percent}%` : 'new'}</span>
        </div>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.excerpt || 'No preview yet.')}</p>
        <div class="card-bottom">
          <span>${escapeHtml(item.folder || '')}</span>
          <span>${item.words ? `${item.words} words` : ''}</span>
        </div>
      </a>`;
    }).join('');

    els.emptyState.hidden = items.length !== 0;
  }

  async function openWork(id, options = {}) {
    const item = state.manifest.find((entry) => entry.id === id);
    if (!item) {
      els.readerTitle.textContent = 'Text not found';
      els.readerContent.innerHTML = '<p class="muted">This entry is missing from the manifest.</p>';
      return;
    }

    stopTypewriter();
    state.current = item;
    writeJson(STORAGE.last, { id: item.id, at: new Date().toISOString() });
    els.readerKind.textContent = labelFor(item);
    els.readerTitle.textContent = item.title;
    els.readerMeta.textContent = `${item.folder || 'Root'} · ${item.words || 0} words · saved locally`;
    els.readerContent.innerHTML = '<p class="muted">Loading text…</p>';

    try {
      const response = await fetch(encodeURI(item.path));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const markdown = await response.text();
      state.currentHtml = markdownToHtml(markdown);
      const saved = getProgress(item.id);
      els.readerProgressBar.style.width = `${Math.min(100, saved.percent || 0)}%`;
      if (options.instant || saved.percent > 0) {
        showFullText();
        restoreScroll(saved.scroll || 0);
      } else {
        await typewriter(state.currentHtml);
      }
      els.readerArticle.focus({ preventScroll: true });
    } catch (error) {
      els.readerContent.innerHTML = `<p class="muted">Could not load <code>${escapeHtml(item.path)}</code>.</p><p>${escapeHtml(error.message)}</p>`;
    }
  }

  function stopTypewriter() {
    if (state.typeTimer) clearTimeout(state.typeTimer);
    state.typeTimer = null;
    els.readerContent.classList.remove('type-cursor');
  }

  function showFullText() {
    stopTypewriter();
    els.readerContent.innerHTML = state.currentHtml || '<p class="muted">Nothing loaded.</p>';
  }

  function typewriter(html) {
    stopTypewriter();
    els.readerContent.innerHTML = '';
    els.readerContent.classList.add('type-cursor');
    const speed = Number(els.speedSlider.value || 7);
    let i = 0;
    return new Promise((resolve) => {
      const tick = () => {
        if (i >= html.length) { stopTypewriter(); resolve(); return; }
        const nextTag = html[i] === '<';
        if (nextTag) {
          const close = html.indexOf('>', i);
          i = close === -1 ? html.length : close + 1;
        } else {
          i += html[i] === '&' ? Math.max(1, (html.indexOf(';', i) - i + 1)) : 1;
        }
        els.readerContent.innerHTML = html.slice(0, i);
        state.typeTimer = setTimeout(tick, Math.max(1, 22 - speed));
      };
      tick();
    });
  }

  function restoreScroll(y) {
    state.restoring = true;
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' });
      state.restoring = false;
    });
  }

  function updateReadingProgress() {
    if (!state.current || state.restoring) return;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const percent = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    setProgress(state.current.id, { percent, scroll: window.scrollY });
    els.readerProgressBar.style.width = `${percent}%`;
    updateHomeStatus();
    if (location.hash !== `#reader/${state.current.id}`) return;
  }

  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', () => window.requestAnimationFrame(updateReadingProgress), { passive: true });

    els.searchInput.addEventListener('input', (event) => {
      state.search = event.target.value;
      renderLibrary();
    });
    $$('.filter').forEach((button) => button.addEventListener('click', () => {
      state.activeFilter = button.dataset.filter;
      $$('.filter').forEach((btn) => btn.classList.toggle('active', btn === button));
      renderLibrary();
    }));

    els.themeToggle.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    els.continueButton.addEventListener('click', () => {
      const last = readJson(STORAGE.last, null);
      location.hash = last?.id ? `#reader/${last.id}` : '#library';
    });

    els.playTypewriter.addEventListener('click', () => {
      if (state.currentHtml) typewriter(state.currentHtml);
    });
    els.showInstant.addEventListener('click', showFullText);

    const savedSpeed = localStorage.getItem(STORAGE.speed);
    if (savedSpeed) els.speedSlider.value = savedSpeed;
    els.speedSlider.addEventListener('input', () => localStorage.setItem(STORAGE.speed, els.speedSlider.value));
  }

  async function init() {
    applyTheme(localStorage.getItem(STORAGE.theme) || 'dark');
    bindEvents();
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      state.manifest = (data.items || []).map((item) => ({ ...item, id: item.id || slugFromPath(item.path) }));
    } catch (error) {
      els.libraryGrid.innerHTML = `<p class="muted">Could not load the library manifest: ${escapeHtml(error.message)}</p>`;
    }
    renderLibrary();
    updateHomeStatus();
    route();
  }

  init();
})();
