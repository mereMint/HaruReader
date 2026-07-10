(function() {
  'use strict';

  var MANIFEST_URL = 'content-manifest.json';
  var GATE_SECONDS = 8;

  var STORAGE = {
    progress: 'harureader.progress.v2',
    last: 'harureader.last.v2',
    gateDone: 'harureader.gateDone.v1'
  };

  /* ---- internal state (not accessible from console) ---- */
  var state = {
    manifest: [],
    activeFilter: 'all',
    search: '',
    current: null,
    currentHtml: '',
    requestId: 0,
    restoring: false,
    gateTimer: null,
    gateRemaining: GATE_SECONDS,
    gateUnlocked: false
  };

  /* ---- DOM refs ---- */
  var els = {};
  function cacheEls() {
    els.body = document.body;
    els.views = Array.from(document.querySelectorAll('[data-view]'));
    els.nav = Array.from(document.querySelectorAll('[data-nav]'));
    els.libraryGrid = document.querySelector('#libraryGrid');
    els.emptyState = document.querySelector('#emptyState');
    els.searchInput = document.querySelector('#searchInput');
    els.readerKind = document.querySelector('#readerKind');
    els.readerTitle = document.querySelector('#readerTitle');
    els.readerMeta = document.querySelector('#readerMeta');
    els.readerProgressBar = document.querySelector('#readerProgressBar');
    els.readerContent = document.querySelector('#readerContent');
    els.readerArticle = document.querySelector('#readerArticle');
    els.continueBtn = document.querySelector('#continueBtn');
    els.heroLibraryBtn = document.querySelector('#heroLibraryBtn');
    els.warningText = document.querySelector('#warningText');
    els.warningTimer = document.querySelector('#warningTimer');
    els.utterancesWrap = document.querySelector('#utterancesWrap');
  }

  /* ---- localStorage helpers ---- */
  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key)) || fb; }
    catch (e) { return fb; }
  }
  function writeJson(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function getProgressMap() { return readJson(STORAGE.progress, {}); }
  function getProgress(id) { return getProgressMap()[id] || { percent: 0, scroll: 0, updatedAt: null }; }
  function setProgress(id, patch) {
    var map = getProgressMap();
    map[id] = Object.assign(map[id] || {}, patch, { updatedAt: new Date().toISOString() });
    writeJson(STORAGE.progress, map);
  }

  /* ---- safe html ---- */
  function escapeHtml(v) {
    v = String(v || '');
    return v.replace(/[&<>"]/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---- inline markdown ---- */
  function inlineMd(text) {
    return escapeHtml(text)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  /* ---- release date check ---- */
  function isReleased(item) {
    if (!item.releaseAt) return true;
    try {
      var release = new Date(item.releaseAt).getTime();
      if (isNaN(release)) return true;
      return Date.now() >= release;
    } catch (e) { return true; }
  }

  function formatReleaseDate(dateStr) {
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    } catch (e) { return dateStr; }
  }

  /* ---- markdown to html (strips first H1 if matches title, strips content warning blockquote) ---- */
  function markdownToHtml(md, title) {
    var norm = md.replace(/^---[\s\S]*?---\s*/, '').replace(/\r\n/g, '\n');
    var lines = norm.split('\n');
    var html = [], para = [], list = null, inCode = false, code = [];
    var firstHeading = true;

    function flushP() {
      if (!para.length) return;
      html.push('<p>' + inlineMd(para.join(' ')) + '</p>');
      para = [];
    }
    function closeList() {
      if (!list) return;
      html.push('</' + list + '>');
      list = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trimEnd();
      if (line.trim().startsWith('```')) {
        if (inCode) { html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'); code = []; inCode = false; }
        else { flushP(); closeList(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(raw); continue; }
      if (!line.trim()) { flushP(); closeList(); continue; }
      if (/^---+$/.test(line.trim())) { flushP(); closeList(); html.push('<hr>'); continue; }

      // Strip content warning blockquote
      if (/^>\s*\*?\*?[Cc]ontent warning:?\*?\*?\s*/.test(line)) continue;

      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flushP(); closeList();
        if (firstHeading && h[1].length === 1) {
          firstHeading = false;
          if (title && h[2].trim().toLowerCase() === title.toLowerCase()) continue;
        }
        var lvl = Math.min(3, h[1].length);
        html.push('<h' + lvl + '>' + inlineMd(h[2]) + '</h' + lvl + '>');
        continue;
      }

      var q = /^>\s?(.*)$/.exec(line);
      if (q) {
        flushP(); closeList();
        if (/^\*?\*?[Cc]ontent warning/i.test(q[1])) continue;
        html.push('<blockquote>' + inlineMd(q[1]) + '</blockquote>');
        continue;
      }

      var ul = /^[-*]\s+(.*)$/.exec(line.trim());
      var ol = /^\d+[.)]\s+(.*)$/.exec(line.trim());
      if (ul || ol) {
        flushP();
        var want = ul ? 'ul' : 'ol';
        if (list !== want) { closeList(); list = want; html.push('<' + list + '>'); }
        html.push('<li>' + inlineMd((ul || ol)[1]) + '</li>');
        continue;
      }
      para.push(line.trim());
    }
    flushP(); closeList();
    if (inCode) html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
    return html.join('\n') || '<p class="muted">This file is empty.</p>';
  }

  /* ---- routing ---- */
  function route() {
    var hash = location.hash.replace(/^#/, '') || 'home';
    if (hash === 'continue') {
      var last = readJson(STORAGE.last, null);
      if (last && last.id) {
        location.replace('#reader/' + last.id);
      } else {
        location.replace('#library');
      }
      return;
    }
    var parts = hash.split('/');
    var view = parts[0], id = parts[1];
    if (view === 'reader' && !id) { location.replace('#library'); return; }
    showView(view || 'home');
    if (view === 'reader' && id) openWork(id);
    if (view === 'library') renderLibrary();
    if (view === 'home') startGate();
  }

  /* ---- continue button ---- */
  function updateContinueButton() {
    if (!els.continueBtn) return;
    var last = readJson(STORAGE.last, null);
    var found = last && last.id && state.manifest.some(function(it) { return it.id === last.id && isReleased(it); });
    if (found) {
      els.continueBtn.classList.remove('gone');
      els.continueBtn.setAttribute('href', '#reader/' + last.id);
    } else {
      els.continueBtn.classList.add('gone');
      els.continueBtn.setAttribute('href', '#continue');
    }
  }

  /* ---- gate ---- */
  function startGate() {
    if (state.gateUnlocked) return;
    try {
      if (localStorage.getItem(STORAGE.gateDone) === '1') {
        state.gateUnlocked = true;
        if (els.heroLibraryBtn) { els.heroLibraryBtn.style.pointerEvents = ''; els.heroLibraryBtn.style.opacity = ''; }
        if (els.warningTimer) els.warningTimer.hidden = true;
        return;
      }
    } catch (e) { /* localStorage blocked */ }
    state.gateRemaining = GATE_SECONDS;
    if (els.heroLibraryBtn) { els.heroLibraryBtn.style.pointerEvents = 'none'; els.heroLibraryBtn.style.opacity = '0.45'; }
    if (els.warningTimer) { els.warningTimer.hidden = false; els.warningTimer.textContent = 'Access granted in ' + state.gateRemaining + 's'; }
    if (state.gateTimer) clearInterval(state.gateTimer);
    state.gateTimer = setInterval(function() {
      state.gateRemaining--;
      if (els.warningTimer) els.warningTimer.textContent = 'Access granted in ' + state.gateRemaining + 's';
      if (state.gateRemaining <= 0) {
        clearInterval(state.gateTimer); state.gateTimer = null;
        state.gateUnlocked = true;
        try { localStorage.setItem(STORAGE.gateDone, '1'); } catch (e) {}
        if (els.heroLibraryBtn) { els.heroLibraryBtn.style.pointerEvents = ''; els.heroLibraryBtn.style.opacity = ''; }
        if (els.warningTimer) els.warningTimer.hidden = true;
        if (els.heroLibraryBtn) { els.heroLibraryBtn.classList.add('pulse-once'); setTimeout(function() { els.heroLibraryBtn.classList.remove('pulse-once'); }, 600); }
      }
    }, 1000);
  }

  /* ---- scroll effects ---- */
  function updateHomeScroll() {
    var isHome = els.body.classList.contains('view-home');
    var p = isHome ? Math.max(0, Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.42))) : 0;
    var e = p * p * (3 - 2 * p);
    var wo = p < 0.08 ? 0 : Math.min(1, (p - 0.08) / 0.34) * 0.98;
    var ws = 0.96 + e * 0.04;
    var to = Math.max(0, 1 - (p / 0.42));
    var bo = state.gateUnlocked ? Math.max(0, 1 - (p / 0.22)) : 0.45;
    var ad = isHome ? 0.36 + e * 0.48 : 0.72;
    var go = isHome ? 0.82 - e * 0.28 : 0.68;
    els.body.style.setProperty('--home-scroll-progress', e.toFixed(3));
    els.body.style.setProperty('--title-opacity', to.toFixed(3));
    els.body.style.setProperty('--button-opacity', bo.toFixed(3));
    els.body.style.setProperty('--warning-opacity', wo.toFixed(3));
    els.body.style.setProperty('--warning-scale', ws.toFixed(3));
    els.body.style.setProperty('--ambient-darkness', ad.toFixed(3));
    els.body.style.setProperty('--grid-opacity', go.toFixed(3));
    els.body.classList.toggle('home-scrolled', isHome && p > 0.08);
  }

  function showView(name) {
    var legal = ['home', 'library', 'reader'];
    var active = legal.indexOf(name) > -1 ? name : 'home';
    els.views.forEach(function(v) { v.hidden = v.dataset.view !== active; });
    els.nav.forEach(function(n) {
      var nv = n.dataset.nav;
      if (nv === 'continue') return;
      n.classList.toggle('active', nv === active);
    });
    els.body.classList.remove('view-home', 'view-library', 'view-reader', 'home-scrolled');
    els.body.classList.add('view-' + active);
    requestAnimationFrame(updateHomeScroll);
    if (active !== 'home' && state.gateTimer) { clearInterval(state.gateTimer); state.gateTimer = null; }
  }

  /* ---- library ---- */
  function labelFor(item) {
    if (item.kind === 'novel') return item.volume ? 'NOVEL \u00b7 ' + item.volume : 'NOVEL';
    return 'SKIT';
  }

  function renderLibrary() {
    var q = state.search.trim().toLowerCase();
    var items = state.manifest.filter(function(it) {
      if (state.activeFilter !== 'all' && it.kind !== state.activeFilter) return false;
      if (!q) return true;
      return (it.title + ' ' + (it.excerpt || '') + ' ' + it.kind).toLowerCase().indexOf(q) > -1;
    });
    els.libraryGrid.innerHTML = items.map(function(it) {
      var released = isReleased(it);
      var p = released ? getProgress(it.id) : { percent: 0 };
      var pc = Math.round(p.percent || 0);
      var href = released ? '#reader/' + it.id : '#library';
      var badgeLabel = labelFor(it);
      if (!released) badgeLabel = 'COMING ' + formatReleaseDate(it.releaseAt);
      var chipText = released ? (pc ? pc + '%' : 'new') : '\uD83D\uDD12';
      return '<a class="work-card' + (released ? '' : ' locked') + '" href="' + href + '" aria-label="' + escapeHtml(it.title) + '">' +
        '<div class="card-top">' +
          '<span class="badge">' + escapeHtml(badgeLabel) + '</span>' +
          '<span class="progress-chip">' + chipText + '</span>' +
        '</div>' +
        '<h2>' + escapeHtml(it.title) + '</h2>' +
        '<p>' + escapeHtml(it.excerpt || 'No preview yet.') + '</p>' +
        '<div class="card-bottom">' +
          '<span>' + (it.words ? it.words + ' words' : '') + '</span>' +
        '</div>' +
      '</a>';
    }).join('');
    els.emptyState.hidden = items.length !== 0;
    updateContinueButton();
  }

  /* ---- utteranc.es comments ---- */
  function loadUtterances() {
    if (!els.utterancesWrap || !state.current) return;
    els.utterancesWrap.innerHTML = '';
    var script = document.createElement('script');
    script.src = 'https://utteranc.es/client.js';
    script.setAttribute('repo', 'mereMint/HaruReader');
    script.setAttribute('issue-term', 'comment:' + state.current.id);
    script.setAttribute('label', 'comment:' + state.current.id);
    script.setAttribute('theme', 'github-dark');
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;
    els.utterancesWrap.appendChild(script);
  }

  /* ---- reader ---- */
  function normalizeContentPath(path) {
    path = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.indexOf('..') > -1 || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    return path;
  }

  function contentUrls(item) {
    var p = normalizeContentPath(item.path);
    if (!p) return [];
    var set = {};
    set[new URL(p, document.baseURI).href] = 1;
    set[new URL(p, new URL(MANIFEST_URL, document.baseURI)).href] = 1;
    set[new URL('./' + p, document.baseURI).href] = 1;
    return Object.keys(set);
  }

  function fetchTextFile(item) {
    var urls = contentUrls(item);
    if (!urls.length) return Promise.reject(new Error('Invalid path.'));
    var lastErr = 'Unreachable.';
    function tryUrl(i) {
      if (i >= urls.length) return Promise.reject(new Error(lastErr));
      return fetch(urls[i], { cache: 'no-store' }).then(function(r) {
        if (r.ok) return r.text();
        lastErr = r.status + ' ' + (r.statusText || 'Not Found');
        return tryUrl(i + 1);
      }).catch(function(e) {
        lastErr = e.message || lastErr;
        return tryUrl(i + 1);
      });
    }
    return tryUrl(0);
  }

  function openWork(id) {
    var item = state.manifest.find(function(e) { return e.id === id; });
    if (!item) { location.replace('#library'); return; }

    // Block unreleased content
    if (!isReleased(item)) {
      els.readerKind.textContent = 'COMING SOON';
      els.readerTitle.textContent = item.title;
      els.readerMeta.textContent = 'Available ' + formatReleaseDate(item.releaseAt);
      els.readerMeta.hidden = false;
      els.readerContent.innerHTML = '<p class="muted">This content will be available on ' + formatReleaseDate(item.releaseAt) + '.</p>';
      if (els.utterancesWrap) els.utterancesWrap.innerHTML = '';
      return;
    }

    var rid = ++state.requestId;
    state.current = item;
    try { writeJson(STORAGE.last, { id: item.id, at: new Date().toISOString() }); } catch (e) {}
    els.readerKind.textContent = labelFor(item);
    els.readerTitle.textContent = item.title;
    els.readerMeta.textContent = item.words ? item.words + ' words' : '';
    els.readerMeta.hidden = !item.words;
    els.readerContent.innerHTML = '<p class="muted">Loading text\u2026</p>';

    fetchTextFile(item).then(function(md) {
      if (rid !== state.requestId) return;
      state.currentHtml = markdownToHtml(md, item.title);
      var saved = getProgress(item.id);
      els.readerProgressBar.style.width = Math.min(100, saved.percent || 0) + '%';
      els.readerContent.classList.remove('type-cursor', 'letter-glitch');
      els.readerContent.innerHTML = state.currentHtml;
      restoreScroll(saved.scroll || 0);
      els.readerArticle.focus({ preventScroll: true });
      loadUtterances();
      updateContinueButton();
    }).catch(function(err) {
      if (rid !== state.requestId) return;
      els.readerContent.innerHTML = '<p class="muted">Could not load this text.</p><p>' + escapeHtml(err.message) + '</p>';
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
    if (!state.current || state.restoring) return;
    if (location.hash.indexOf('#reader/' + state.current.id) !== 0) return;
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    var pct = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    try { setProgress(state.current.id, { percent: pct, scroll: window.scrollY }); } catch (e) {}
    els.readerProgressBar.style.width = pct + '%';
  }

  /* ---- content warnings from manifest items ---- */
  function parseContentWarnings(md) {
    var m = md.match(/^>\s*\*?\*?[Cc]ontent warning:?\*?\*?\s*(.+)$/m);
    if (!m) return [];
    return m[1].split(/[,;]\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
  }

  function aggregateContentWarnings() {
    var seen = {};
    var all = [];
    state.manifest.forEach(function(it) {
      var cw = it._warnings || [];
      cw.forEach(function(w) {
        var l = w.toLowerCase();
        if (!seen[l]) { seen[l] = true; all.push(w); }
      });
    });
    if (!all.length) return 'Violence, death, psychological distress, mature themes.';
    return all.map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(', ') + '.';
  }

  /* ---- events ---- */
  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', function() {
      window.requestAnimationFrame(function() { updateReadingProgress(); updateHomeScroll(); });
    }, { passive: true });
    if (els.searchInput) {
      els.searchInput.addEventListener('input', function(e) { state.search = e.target.value; renderLibrary(); });
    }
    Array.from(document.querySelectorAll('.filter')).forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.activeFilter = btn.dataset.filter;
        Array.from(document.querySelectorAll('.filter')).forEach(function(b) { b.classList.toggle('active', b === btn); });
        renderLibrary();
      });
    });
  }

  /* ---- init ---- */
  function init() {
    cacheEls();
    bindEvents();

    fetch(MANIFEST_URL, { cache: 'no-store' }).then(function(r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.json();
    }).then(function(data) {
      state.manifest = (data.items || []).map(function(it) {
        return Object.assign({}, it, { id: it.id || slugFromPath(it.path) });
      });

      // Fetch each markdown to extract content warnings
      var promises = state.manifest.map(function(it) {
        return fetchTextFile(it).then(function(md) {
          it._warnings = parseContentWarnings(md);
        }).catch(function() {
          it._warnings = [];
        });
      });
      return Promise.all(promises).then(function() { return data; });
    }).then(function() {
      if (els.warningText) els.warningText.textContent = aggregateContentWarnings();
      renderLibrary();
      route();
    }).catch(function(e) {
      if (els.libraryGrid) els.libraryGrid.innerHTML = '<p class="muted">Could not load manifest: ' + escapeHtml(e.message) + '</p>';
      route();
    });
  }

  function slugFromPath(p) { return p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
