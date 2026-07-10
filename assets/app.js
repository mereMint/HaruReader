(() => {
  const MANIFEST_URL = 'content-manifest.json';
  const STORAGE = {
    progress: 'harureader.progress.v1',
    last: 'harureader.last.v1',
    comments: 'harureader.comments.v1'
  };
  const GATE_SECONDS = 6;

  const state = {
    manifest: [],
    activeFilter: 'all',
    search: '',
    current: null,
    currentHtml: '',
    typeTimer: null,
    requestId: 0,
    restoring: false,
    gateTimer: null,
    gateRemaining: GATE_SECONDS,
    gateUnlocked: false
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
    readerKind: $('#readerKind'),
    readerTitle: $('#readerTitle'),
    readerMeta: $('#readerMeta'),
    readerProgressBar: $('#readerProgressBar'),
    readerContent: $('#readerContent'),
    readerArticle: $('#readerArticle'),
    continueBtn: $('#continueBtn'),
    heroLibraryBtn: $('#heroLibraryBtn'),
    warningText: $('#warningText'),
    warningTimer: $('#warningTimer'),
    commentsSection: $('#commentsSection'),
    commentsList: $('#commentsList'),
    commentInput: $('#commentInput'),
    commentName: $('#commentName'),
    commentSubmit: $('#commentSubmit')
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
  function getComments(id) { return readJson(STORAGE.comments, {})[id] || []; }
  function setComments(id, list) {
    const map = readJson(STORAGE.comments, {});
    map[id] = list;
    writeJson(STORAGE.comments, map);
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
      html.push('<p>' + inlineMarkdown(paragraph.join(' ')) + '</p>');
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      html.push('</' + list + '>');
      list = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
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
        html.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>');
        continue;
      }

      const quote = /^>\s?(.*)$/.exec(line);
      if (quote) { flushParagraph(); closeList(); html.push('<blockquote>' + inlineMarkdown(quote[1]) + '</blockquote>'); continue; }

      const unordered = /^[-*]\s+(.*)$/.exec(line.trim());
      const ordered = /^\d+[.)]\s+(.*)$/.exec(line.trim());
      if (unordered || ordered) {
        flushParagraph();
        const desired = unordered ? 'ul' : 'ol';
        if (list !== desired) { closeList(); list = desired; html.push('<' + list + '>'); }
        html.push('<li>' + inlineMarkdown((unordered || ordered)[1]) + '</li>');
        continue;
      }
      paragraph.push(line.trim());
    }

    flushParagraph(); closeList();
    if (inCode) html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
    return html.join('\n') || '<p class="muted">This file is empty.</p>';
  }

  function route() {
    const hash = location.hash.replace(/^#/, '') || 'home';
    if (hash === 'continue') {
      const last = readJson(STORAGE.last, null);
      if (last && last.id) {
        location.replace('#reader/' + last.id);
        return;
      }
      location.replace('#library');
      return;
    }
    const [view, id] = hash.split('/');
    if (view === 'reader' && !id) {
      location.replace('#library');
      return;
    }
    showView(view || 'home');
    if (view === 'reader' && id) openWork(id);
    if (view === 'library') renderLibrary();
    if (view === 'home') startGate();
  }

  function updateContinueButton() {
    const last = readJson(STORAGE.last, null);
    if (last && last.id && state.manifest.some(function(item) { return item.id === last.id; })) {
      els.continueBtn.classList.remove('gone');
      els.continueBtn.href = '#reader/' + last.id;
    } else {
      els.continueBtn.classList.add('gone');
    }
  }

  function startGate() {
    if (state.gateUnlocked) return;
    state.gateRemaining = GATE_SECONDS;
    if (els.heroLibraryBtn) {
      els.heroLibraryBtn.style.pointerEvents = 'none';
      els.heroLibraryBtn.style.opacity = '0.45';
    }
    if (els.warningTimer) {
      els.warningTimer.hidden = false;
      els.warningTimer.textContent = 'ACCESS GRANTED IN ' + state.gateRemaining + 's';
    }
    if (state.gateTimer) clearInterval(state.gateTimer);
    state.gateTimer = setInterval(function() {
      state.gateRemaining--;
      if (els.warningTimer) {
        els.warningTimer.textContent = 'ACCESS GRANTED IN ' + state.gateRemaining + 's';
      }
      if (state.gateRemaining <= 0) {
        clearInterval(state.gateTimer);
        state.gateTimer = null;
        state.gateUnlocked = true;
        if (els.heroLibraryBtn) {
          els.heroLibraryBtn.style.pointerEvents = '';
          els.heroLibraryBtn.style.opacity = '';
        }
        if (els.warningTimer) {
          els.warningTimer.hidden = true;
        }
        if (els.heroLibraryBtn) {
          els.heroLibraryBtn.classList.add('pulse-once');
          setTimeout(function() { els.heroLibraryBtn.classList.remove('pulse-once'); }, 600);
        }
      }
    }, 1000);
  }

  function updateHomeScroll() {
    const isHome = els.body.classList.contains('view-home');
    const progress = isHome ? Math.max(0, Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.42))) : 0;
    const eased = progress * progress * (3 - 2 * progress);
    const warningOpacity = progress < 0.08 ? 0 : Math.min(1, (progress - 0.08) / 0.34) * 0.98;
    const warningScale = 0.96 + eased * 0.04;
    const titleOpacity = Math.max(0, 1 - (progress / 0.42));
    const buttonOpacity = state.gateUnlocked ? Math.max(0, 1 - (progress / 0.22)) : 0.45;
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
    els.views.forEach(function(view) { view.hidden = view.dataset.view !== active; });
    els.nav.forEach(function(nav) { nav.classList.toggle('active', nav.dataset.nav === active); });
    els.body.classList.remove('view-home', 'view-library', 'view-reader', 'home-scrolled');
    els.body.classList.add('view-' + active);
    requestAnimationFrame(updateHomeScroll);
    if (active !== 'home' && state.gateTimer) {
      clearInterval(state.gateTimer);
      state.gateTimer = null;
    }
  }

  function labelFor(item) {
    if (item.kind === 'novel') return item.volume ? 'NOVEL \u00b7 ' + item.volume : 'NOVEL';
    return 'SKIT';
  }

  function normalizeContentPath(path) {
    if (!path) path = '';
    const value = String(path).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!value || value.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    return value;
  }

  function contentUrls(item) {
    const path = normalizeContentPath(item.path);
    if (!path) return [];
    return Array.from(new Set([
      new URL(path, document.baseURI).href,
      new URL(path, new URL(MANIFEST_URL, document.baseURI)).href,
      new URL('./' + path, document.baseURI).href
    ]));
  }

  async function fetchTextFile(item) {
    const urls = contentUrls(item);
    if (!urls.length) throw new Error('The text file path is invalid.');
    let lastError = 'Text file is missing or unreachable.';
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) return response.text();
        lastError = response.status + ' ' + (response.statusText || 'Not Found');
      } catch (error) {
        lastError = error.message || lastError;
      }
    }
    throw new Error(lastError);
  }

  function renderLibrary() {
    const query = state.search.trim().toLowerCase();
    const items = state.manifest.filter(function(item) {
      const typeMatch = state.activeFilter === 'all' || item.kind === state.activeFilter;
      const haystack = (item.title + ' ' + item.excerpt + ' ' + item.kind).toLowerCase();
      return typeMatch && (!query || haystack.includes(query));
    });

    els.libraryGrid.innerHTML = items.map(function(item) {
      const progress = getProgress(item.id);
      const percent = Math.round(progress.percent || 0);
      return '<a class="work-card" href="#reader/' + item.id + '" aria-label="Read ' + escapeHtml(item.title) + '">' +
        '<div class="card-top">' +
          '<span class="badge">' + escapeHtml(labelFor(item)) + '</span>' +
          '<span class="progress-chip">' + (percent ? percent + '%' : 'new') + '</span>' +
        '</div>' +
        '<h2>' + escapeHtml(item.title) + '</h2>' +
        '<p>' + escapeHtml(item.excerpt || 'No preview yet.') + '</p>' +
        '<div class="card-bottom">' +
          '<span>' + (item.words ? item.words + ' words' : '') + '</span>' +
        '</div>' +
      '</a>';
    }).join('');

    els.emptyState.hidden = items.length !== 0;
  }

  function renderComments(id) {
    const all = readJson(STORAGE.comments, {});
    const comments = all[id] || [];
    if (!comments.length) {
      els.commentsList.innerHTML = '<p class="comments-empty">No comments yet. Be the first.</p>';
    } else {
      els.commentsList.innerHTML = comments.map(function(c) {
        return '<div class="comment-item">' +
          '<div class="comment-meta">' +
            '<span>' + escapeHtml(c.name || 'Anonymous') + '</span>' +
            '<span>' + escapeHtml(c.time || '') + '</span>' +
          '</div>' +
          '<div class="comment-body">' + escapeHtml(c.body) + '</div>' +
        '</div>';
      }).join('');
    }
    els.commentsSection.hidden = false;
  }

  function postComment() {
    if (!state.current) return;
    const body = (els.commentInput.value || '').trim();
    if (!body) return;
    const name = (els.commentName.value || '').trim() || 'Anonymous';
    const all = readJson(STORAGE.comments, {});
    const list = all[state.current.id] || [];
    list.push({
      name: name,
      body: body,
      time: new Date().toLocaleString()
    });
    all[state.current.id] = list;
    writeJson(STORAGE.comments, all);
    els.commentInput.value = '';
    els.commentName.value = '';
    renderComments(state.current.id);
  }

  async function openWork(id) {
    const item = state.manifest.find(function(entry) { return entry.id === id; });
    if (!item) {
      location.replace('#library');
      return;
    }

    stopTypewriter();
    const requestId = ++state.requestId;
    state.current = item;
    writeJson(STORAGE.last, { id: item.id, at: new Date().toISOString() });
    els.readerKind.textContent = labelFor(item);
    els.readerTitle.textContent = item.title;
    els.readerMeta.textContent = item.words ? item.words + ' words' : '';
    els.readerMeta.hidden = !item.words;
    els.readerContent.innerHTML = '<p class="muted">Loading text\u2026</p>';
    els.commentsSection.hidden = true;
    els.commentsList.innerHTML = '';

    try {
      const markdown = await fetchTextFile(item);
      if (requestId !== state.requestId) return;
      state.currentHtml = markdownToHtml(markdown);
      const saved = getProgress(item.id);
      els.readerProgressBar.style.width = Math.min(100, saved.percent || 0) + '%';
      showFullText();
      restoreScroll(saved.scroll || 0);
      els.readerArticle.focus({ preventScroll: true });
      renderComments(item.id);
      updateContinueButton();
    } catch (error) {
      if (requestId !== state.requestId) return;
      els.readerContent.innerHTML = '<p class="muted">Could not load this text. The Markdown file is missing or unreachable.</p><p>' + escapeHtml(error.message) + '</p>';
    }
  }

  function stopTypewriter() {
    if (state.typeTimer) clearTimeout(state.typeTimer);
    state.typeTimer = null;
    els.readerContent.classList.remove('type-cursor', 'letter-glitch', 'font-a', 'font-b', 'font-c');
  }

  function showFullText() {
    stopTypewriter();
    els.readerContent.innerHTML = state.currentHtml || '<p class="muted">Nothing loaded.</p>';
  }

  function typewriter(html) {
    stopTypewriter();
    els.readerContent.innerHTML = '';
    els.readerContent.classList.add('type-cursor');
    let i = 0;
    return new Promise(function(resolve) {
      const tick = function() {
        if (i >= html.length) { stopTypewriter(); els.readerContent.innerHTML = html; resolve(); return; }

        if (html[i] === '<') {
          const close = html.indexOf('>', i);
          i = close === -1 ? html.length : close + 1;
        } else if (html[i] === '&') {
          const close = html.indexOf(';', i);
          i = close === -1 ? i + 1 : close + 1;
        } else {
          i += 1;
        }
        els.readerContent.innerHTML = html.slice(0, i);
        state.typeTimer = setTimeout(tick, 3);
      };
      tick();
    });
  }

  function restoreScroll(y) {
    state.restoring = true;
    requestAnimationFrame(function() {
      window.scrollTo({ top: y, behavior: 'instant' });
      state.restoring = false;
    });
  }

  function updateReadingProgress() {
    if (!state.current || state.restoring || !location.hash.startsWith('#reader/' + state.current.id)) return;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const percent = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    setProgress(state.current.id, { percent: percent, scroll: window.scrollY });
    els.readerProgressBar.style.width = percent + '%';
  }

  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', function() {
      window.requestAnimationFrame(function() {
        updateReadingProgress();
        updateHomeScroll();
      });
    }, { passive: true });

    els.searchInput.addEventListener('input', function(event) {
      state.search = event.target.value;
      renderLibrary();
    });
    $$('.filter').forEach(function(button) {
      button.addEventListener('click', function() {
        state.activeFilter = button.dataset.filter;
        $$('.filter').forEach(function(btn) { btn.classList.toggle('active', btn === button); });
        renderLibrary();
      });
    });

    if (els.commentSubmit) {
      els.commentSubmit.addEventListener('click', postComment);
    }
    if (els.commentInput) {
      els.commentInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment();
      });
    }
  }

  function aggregateContentWarnings(manifest) {
    const warnings = manifest.contentWarnings || [];
    const seen = new Set();
    const unique = [];
    for (var i = 0; i < warnings.length; i++) {
      const w = warnings[i];
      const lower = w.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        unique.push(w);
      }
    }
    if (!unique.length) {
      const items = manifest.items || manifest;
      for (var j = 0; j < items.length; j++) {
        if (items[j].contentWarning) {
          const lower = items[j].contentWarning.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            unique.push(items[j].contentWarning);
          }
        }
      }
    }
    if (unique.length) {
      return unique.join('; ');
    }
    return 'Violence, death, psychological distress, mature themes.';
  }

  async function init() {
    bindEvents();
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
      const data = await response.json();
      state.manifest = (data.items || []).map(function(item) { return Object.assign({}, item, { id: item.id || slugFromPath(item.path) }); });
      state.manifest.contentWarnings = data.contentWarnings || [];
    } catch (error) {
      els.libraryGrid.innerHTML = '<p class="muted">Could not load the library manifest: ' + escapeHtml(error.message) + '</p>';
    }

    if (els.warningText) {
      els.warningText.textContent = aggregateContentWarnings(state.manifest);
    }

    updateContinueButton();
    renderLibrary();
    route();
  }

  init();
})();
