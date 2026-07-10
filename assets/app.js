(() => {
  const MANIFEST_URL = 'content-manifest.json';
  const STORAGE = {
    progress: 'harureader.progress.v1',
    last: 'harureader.last.v1',
    theme: 'harureader.theme.v1'
  };

  const state = {
    manifest: [],
    activeFilter: 'all',
    search: '',
    current: null,
    currentHtml: '',
    typeTimer: null,
    glitchTimer: null,
    restoring: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const els = {
    body: document.body,
    views: $$('[data-view]'),
    nav: $$('[data-nav]'),
    libraryGrid: $('#libraryGrid'),
    emptyState: $('#emptyState'),
    searchInput: $('#searchInput'),
    themeToggle: $('#themeToggle'),
    readerKind: $('#readerKind'),
    readerTitle: $('#readerTitle'),
    readerMeta: $('#readerMeta'),
    readerProgressBar: $('#readerProgressBar'),
    readerContent: $('#readerContent'),
    readerArticle: $('#readerArticle')
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
    if (view === 'reader' && !id) {
      location.replace('#library');
      return;
    }
    showView(view || 'home');
    if (view === 'reader' && id) openWork(id);
    if (view === 'library') renderLibrary();
  }

  function updateHomeScroll() {
    const isHome = els.body.classList.contains('view-home');
    const progress = isHome ? Math.max(0, Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.42))) : 0;
    const eased = progress * progress * (3 - 2 * progress);
    const warningOpacity = progress < 0.08 ? 0 : Math.min(1, (progress - 0.08) / 0.34) * 0.98;
    const warningScale = 0.86 + eased * 0.42;
    const titleOpacity = Math.max(0, 1 - (progress / 0.42));
    const buttonOpacity = Math.max(0, 1 - (progress / 0.22));
    const ambientDarkness = isHome ? 0.36 + eased * 0.48 : 0.72;
    const gridOpacity = isHome ? 0.82 - eased * 0.28 : 0.68;
    els.body.style.setProperty('--home-scroll-progress', eased.toFixed(3));
    els.body.style.setProperty('--title-opacity', titleOpacity.toFixed(3));
    els.body.style.setProperty('--button-opacity', buttonOpacity.toFixed(3));
    els.body.style.setProperty('--warning-opacity', warningOpacity.toFixed(3));
    els.body.style.setProperty('--warning-scale', warningScale.toFixed(3));
    els.body.style.setProperty('--ambient-darkness', ambientDarkness.toFixed(3));
    els.body.style.setProperty('--grid-opacity', gridOpacity.toFixed(3));
    els.body.classList.toggle('home-scrolled', isHome && progress > 0.08);
  }

  function showView(name) {
    const legal = ['home', 'library', 'reader'];
    const active = legal.includes(name) ? name : 'home';
    els.views.forEach((view) => { view.hidden = view.dataset.view !== active; });
    els.nav.forEach((nav) => nav.classList.toggle('active', nav.dataset.nav === active));
    els.body.classList.remove('view-home', 'view-library', 'view-reader', 'home-scrolled');
    els.body.classList.add(`view-${active}`);
    requestAnimationFrame(updateHomeScroll);
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

  async function openWork(id) {
    const item = state.manifest.find((entry) => entry.id === id);
    if (!item) {
      location.replace('#library');
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
      if (saved.percent > 0) {
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
    if (state.glitchTimer) clearTimeout(state.glitchTimer);
    state.typeTimer = null;
    state.glitchTimer = null;
    els.readerContent.classList.remove('type-cursor', 'letter-glitch', 'font-a', 'font-b', 'font-c');
  }

  function showFullText() {
    stopTypewriter();
    els.readerContent.innerHTML = state.currentHtml || '<p class="muted">Nothing loaded.</p>';
  }

  function triggerLetterGlitch(step) {
    els.readerContent.classList.remove('font-a', 'font-b', 'font-c', 'letter-glitch');
    // Force reflow so the short glitch animation restarts for every visible character.
    void els.readerContent.offsetWidth;
    els.readerContent.classList.add(['font-a', 'font-b', 'font-c'][step % 3], 'letter-glitch');
    if (state.glitchTimer) clearTimeout(state.glitchTimer);
    state.glitchTimer = setTimeout(() => {
      els.readerContent.classList.remove('letter-glitch');
    }, 90);
  }

  function typewriter(html) {
    stopTypewriter();
    els.readerContent.innerHTML = '';
    els.readerContent.classList.add('type-cursor');
    let i = 0;
    let step = 0;
    return new Promise((resolve) => {
      const tick = () => {
        if (i >= html.length) { stopTypewriter(); els.readerContent.innerHTML = html; resolve(); return; }
        let visibleLetter = false;
        if (html[i] === '<') {
          const close = html.indexOf('>', i);
          i = close === -1 ? html.length : close + 1;
        } else if (html[i] === '&') {
          const close = html.indexOf(';', i);
          i = close === -1 ? i + 1 : close + 1;
          visibleLetter = true;
        } else {
          i += 1;
          visibleLetter = true;
        }
        els.readerContent.innerHTML = html.slice(0, i);
        if (visibleLetter) triggerLetterGlitch(step++);
        state.typeTimer = setTimeout(tick, 3);
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
    if (!state.current || state.restoring || !location.hash.startsWith(`#reader/${state.current.id}`)) return;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const percent = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    setProgress(state.current.id, { percent, scroll: window.scrollY });
    els.readerProgressBar.style.width = `${percent}%`;
  }

  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', () => window.requestAnimationFrame(() => {
      updateReadingProgress();
      updateHomeScroll();
    }), { passive: true });

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
    route();
  }

  init();
})();
