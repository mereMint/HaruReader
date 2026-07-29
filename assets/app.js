(function() {
  'use strict';

  var buildMeta = document.querySelector('meta[name="harureader-build"]');
  var BUILD_VERSION = buildMeta ? buildMeta.getAttribute('content') : 'dev';
  var CACHE_KEY = '?v=' + encodeURIComponent(BUILD_VERSION || 'dev');
  var MANIFEST_URL = 'content-manifest.json' + CACHE_KEY;
  var ROADMAP_URL = 'src/roadmap.md' + CACHE_KEY;
  var GATE_SECONDS = 1;

  var STORAGE = {
    progress: 'harureader.progress.v2',
    last: 'harureader.last.v2',
    gateDone: 'harureader.gateDone.v1',
    readerPrefs: 'harureader.readerPrefs.v1'
  };

  /* ---- internal state (not accessible from console) ---- */
  var state = {
    manifest: [],
    activeFilter: 'all',
    includeFilters: [],
    excludeFilters: [],
    search: '',
    current: null,
    currentHtml: '',
    textCache: {},
    htmlCache: {},
    requestId: 0,
    activeView: '',
    restoring: false,
    scrollQueued: false,
    pendingProgress: null,
    lastProgressSave: 0,
    renderedProgress: -1,
    readerMetrics: { start: 0, end: 1 },
    ttsExpanded: false,
    preferredVoice: '',
    voiceChosenByUser: false,
    ttsRate: 1,
    ambientBlocks: [],
    ambientScene: 'neutral',
    ambienceEnabled: true,
    reduceMotion: false,
    narrationFollow: true,
    fontScale: 1,
    readerWidth: 68,
    readerSpacing: 1.88,
    gateTimer: null,
    gateRemaining: GATE_SECONDS,
    gateUnlocked: false
  };

  /* ---- DOM refs ---- */
  var els = {};
  function cacheEls() {
    els.body = document.body;
    els.ambientLayers = Array.from(document.querySelectorAll('.ambient-scene'));
    els.views = Array.from(document.querySelectorAll('[data-view]'));
    els.nav = Array.from(document.querySelectorAll('[data-nav]'));
    els.libraryGrid = document.querySelector('#libraryGrid');
    els.emptyState = document.querySelector('#emptyState');
    els.searchInput = document.querySelector('#searchInput');
    els.filterButton = document.querySelector('#filterButton');
    els.filterPanel = document.querySelector('#filterPanel');
    els.readerKind = document.querySelector('#readerKind');
    els.readerTitle = document.querySelector('#readerTitle');
    els.readerMeta = document.querySelector('#readerMeta');
    els.readerProgress = document.querySelector('#readerProgress');
    els.readerProgressValue = document.querySelector('#readerProgressValue');
    els.readerProgressBar = document.querySelector('#readerProgressBar');
    els.readerContent = document.querySelector('#readerContent');
    els.readerArticle = document.querySelector('#readerArticle');
    els.readerTools = document.querySelector('#readerTools');
    els.ttsToggle = document.querySelector('#ttsToggle');
    els.ttsToggleLabel = document.querySelector('#ttsToggleLabel');
    els.ttsStop = document.querySelector('#ttsStop');
    els.ttsCollapse = document.querySelector('#ttsCollapse');
    els.ttsVoice = document.querySelector('#ttsVoice');
    els.ttsRate = document.querySelector('#ttsRate');
    els.ttsStatus = document.querySelector('#ttsStatus');
    els.settingsToggle = document.querySelector('#settingsToggle');
    els.settingsClose = document.querySelector('#settingsClose');
    els.readerSettings = document.querySelector('#readerSettings');
    els.ambientToggle = document.querySelector('#ambientToggle');
    els.motionToggle = document.querySelector('#motionToggle');
    els.ttsFollowToggle = document.querySelector('#ttsFollowToggle');
    els.fontSmaller = document.querySelector('#fontSmaller');
    els.fontLarger = document.querySelector('#fontLarger');
    els.fontSizeValue = document.querySelector('#fontSizeValue');
    els.readerWidth = document.querySelector('#readerWidth');
    els.readerSpacing = document.querySelector('#readerSpacing');
    els.continueBtn = document.querySelector('#continueBtn');
    els.heroLibraryBtn = document.querySelector('#heroLibraryBtn');
    els.warningText = document.querySelector('#warningText');
    els.warningTimer = document.querySelector('#warningTimer');
    els.roadmapPreview = document.querySelector('#roadmapPreview');
    els.roadmapFull = document.querySelector('#roadmapFull');
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
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  /* ---- release date check ---- */
  function isReleased(item) {
    if (item.comingSoon) return false;
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

  var AMBIENT_SCENES = ['neutral', 'rain', 'storm', 'dark', 'night', 'danger', 'warm', 'suspense', 'grief', 'forest', 'clinical', 'neon', 'moonlight', 'emergency', 'monitor', 'mist', 'flicker'];

  /* ---- markdown to html (with optional <!-- ambient: storm --> story cues) ---- */
  function markdownToHtml(md, title) {
    var norm = md.replace(/^---[\s\S]*?---\s*/, '').replace(/\r\n/g, '\n');
    var lines = norm.split('\n');
    var html = [], para = [], list = null, inCode = false, code = [];
    var firstHeading = true, ambient = 'neutral';

    function blockAttrs() {
      return ' data-ambient="' + ambient + '"';
    }

    function flushP() {
      if (!para.length) return;
      var text = para.join(' ');
      html.push('<p' + blockAttrs(text) + '>' + inlineMd(text) + '</p>');
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
      var ambientCue = /^\s*<!--\s*ambient:\s*([^>]+?)\s*-->\s*$/i.exec(line);
      if (ambientCue) {
        flushP(); closeList();
        var requestedScenes = ambientCue[1].toLowerCase().split(/[\s,+]+/).filter(function(scene, index, all) {
          return AMBIENT_SCENES.indexOf(scene) > -1 && all.indexOf(scene) === index;
        });
        if (requestedScenes.length) ambient = requestedScenes.join(' ');
        continue;
      }
      if (!line.trim()) { flushP(); closeList(); continue; }
      if (/^(?:-{3,}|\*\s*\*\s*\*|_{3,})$/.test(line.trim())) { flushP(); closeList(); html.push('<hr>'); continue; }

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
        html.push('<h' + lvl + blockAttrs(h[2]) + '>' + inlineMd(h[2]) + '</h' + lvl + '>');
        continue;
      }

      var q = /^>\s?(.*)$/.exec(line);
      if (q) {
        flushP(); closeList();
        if (/^\*?\*?[Cc]ontent warning/i.test(q[1])) continue;
        html.push('<blockquote' + blockAttrs(q[1]) + '>' + inlineMd(q[1]) + '</blockquote>');
        continue;
      }

      var ul = /^[-*]\s+(.*)$/.exec(line.trim());
      var ol = /^\d+[.)]\s+(.*)$/.exec(line.trim());
      if (ul || ol) {
        flushP();
        var want = ul ? 'ul' : 'ol';
        if (list !== want) { closeList(); list = want; html.push('<' + list + '>'); }
        var listText = (ul || ol)[1];
        html.push('<li' + blockAttrs(listText) + '>' + inlineMd(listText) + '</li>');
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
    flushReadingProgress();
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
    if (view !== 'reader') { stopTts(); setAmbientScene('neutral'); setSettingsOpen(false); }
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
    if (!isHome) return;
    function clamp01(v) { return Math.max(0, Math.min(1, v)); }
    function easeOut(v) { v = clamp01(v); return 1 - Math.pow(1 - v, 3); }
    var scrollScreens = isHome ? window.scrollY / Math.max(1, window.innerHeight) : 0;
    var p = clamp01(scrollScreens / 0.58);
    var e = p * p * (3 - 2 * p);

    var titleLeave = easeOut(scrollScreens / 0.42);
    var buttonLeave = easeOut(scrollScreens / 0.22);
    var roadmapIn = easeOut((scrollScreens - 0.72) / 0.28);
    var roadmapOut = easeOut((scrollScreens - 1.58) / 0.27);
    var roadmapVisible = roadmapIn * (1 - roadmapOut);
    var sigIn = easeOut((scrollScreens - 1.74) / 0.26);
    var warnIn = easeOut((scrollScreens - 1.90) / 0.28);

    var sigY = ((1 - sigIn) * 1.6).toFixed(2) + 'rem';
    var wy = ((1 - warnIn) * 1.25).toFixed(2) + 'rem';
    var to = 1 - titleLeave;
    var bo = state.gateUnlocked ? 1 - buttonLeave : Math.min(0.45, 1 - buttonLeave);
    var ad = isHome ? 0.36 + e * 0.42 : 0.72;
    var go = isHome ? 0.82 - e * 0.28 : 0.68;
    els.body.style.setProperty('--home-scroll-progress', e.toFixed(3));
    els.body.style.setProperty('--title-opacity', to.toFixed(3));
    els.body.style.setProperty('--button-opacity', bo.toFixed(3));
    els.body.style.setProperty('--roadmap-opacity', roadmapVisible.toFixed(3));
    els.body.style.setProperty('--roadmap-scale', (0.975 + roadmapVisible * 0.025).toFixed(3));
    els.body.style.setProperty('--roadmap-y', ((1 - roadmapVisible) * 1.5).toFixed(2) + 'rem');
    els.body.style.setProperty('--signature-opacity', (sigIn * 0.98).toFixed(3));
    els.body.style.setProperty('--signature-scale', (0.985 + sigIn * 0.015).toFixed(3));
    els.body.style.setProperty('--signature-y', sigY);
    els.body.style.setProperty('--warning-opacity', (warnIn * 0.98).toFixed(3));
    els.body.style.setProperty('--warning-scale', (0.985 + warnIn * 0.015).toFixed(3));
    els.body.style.setProperty('--warning-y', wy);
    els.body.style.setProperty('--ambient-darkness', ad.toFixed(3));
    els.body.style.setProperty('--grid-opacity', go.toFixed(3));
    els.body.classList.toggle('home-scrolled', isHome && p > 0.08);
    els.body.classList.toggle('home-stage-roadmap', isHome && roadmapVisible > 0.55);
    els.body.classList.toggle('home-stage-outro', isHome && sigIn > 0.1);
  }

  function showView(name) {
    var legal = ['home', 'library', 'reader', 'roadmap'];
    var active = legal.indexOf(name) > -1 ? name : 'home';
    var viewChanged = state.activeView !== active;
    function swapView() {
      state.activeView = active;
      els.views.forEach(function(v) { v.hidden = v.dataset.view !== active; });
      els.nav.forEach(function(n) {
        var nv = n.dataset.nav;
        if (nv === 'continue') return;
        n.classList.toggle('active', nv === active);
      });
      els.body.classList.remove('view-home', 'view-library', 'view-reader', 'view-roadmap', 'home-scrolled', 'home-stage-roadmap', 'home-stage-outro');
      els.body.classList.add('view-' + active);
      if (viewChanged) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      if (active !== 'home') {
        els.body.style.setProperty('--ambient-darkness', '.72');
        els.body.style.setProperty('--grid-opacity', '.68');
      }
      requestAnimationFrame(updateHomeScroll);
      if (active !== 'home' && state.gateTimer) { clearInterval(state.gateTimer); state.gateTimer = null; }
    }
    var reducedMotion = state.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var compactScreen = window.matchMedia && window.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
    if (viewChanged && state.activeView && document.startViewTransition && !reducedMotion && !compactScreen) {
      document.startViewTransition(swapView);
    } else {
      swapView();
    }
  }

  /* ---- roadmap ---- */
  function parseRoadmap(md) {
    return String(md || '').split(/\r?\n/).map(function(line) {
      var match = line.match(/^\s*([+-])\s+(.+?)\s*$/);
      if (!match) return null;
      var parts = match[2].split(/\s+\|\s+/, 2);
      return { status: match[1] === '+' ? 'archived' : 'upcoming', title: parts[0], detail: parts[1] || '' };
    }).filter(Boolean);
  }

  function roadmapItem(item, index) {
    var archived = item.status === 'archived';
    var current = item.isCurrent === true;
    var phase = archived ? 'Published' : current ? 'In development' : 'Queued';
    return '<li class="roadmap-item ' + (archived ? 'is-archived' : current ? 'is-current' : 'is-upcoming') + '">' +
      '<span class="roadmap-step" aria-hidden="true"><span class="roadmap-marker"></span></span><div class="roadmap-item-card">' +
      '<span class="roadmap-phase">' + phase + '</span>' +
      '<h3>' + escapeHtml(item.title) + '</h3>' +
      (item.detail ? '<p>' + escapeHtml(item.detail) + '</p>' : '') +
      '</div></li>';
  }

  function renderRoadmap(items) {
    var archived = items.filter(function(item) { return item.status === 'archived'; });
    var upcoming = items.filter(function(item) { return item.status === 'upcoming'; });
    items.forEach(function(item) { item.isCurrent = upcoming.length > 0 && item === upcoming[0]; });
    var preview = (archived.length ? [archived[archived.length - 1]] : []).concat(upcoming.slice(0, 2));
    var empty = '<li class="roadmap-item"><div class="roadmap-item-card"><p>No timeline entries yet.</p></div></li>';
    if (els.roadmapPreview) els.roadmapPreview.innerHTML = preview.map(roadmapItem).join('') || empty;
    if (els.roadmapFull) els.roadmapFull.innerHTML = items.map(roadmapItem).join('') || empty;
  }

  /* ---- library ---- */
  function labelFor(item) {
    if (item.series) return String(item.series);
    if (item.kind === 'novel') return item.volume ? 'NOVEL \u00b7 ' + item.volume : 'NOVEL';
    if (item.kind === 'skit') return 'SKIT';
    return String(item.kind || 'TEXT').toUpperCase();
  }

  function canonTag(item) {
    if (item.canon === true) return 'Canon';
    if (item.canon === false) return 'Non-canon';
    return '';
  }

  function displayTags(item) {
    var tags = (item.tags || []).slice();
    var status = canonTag(item);
    if (status) tags.unshift(status);
    return tags;
  }

  function itemTokens(item) {
    var tokens = ['kind:' + String(item.kind || '').toLowerCase()];
    if (item.series) tokens.push('series:' + String(item.series).toLowerCase());
    displayTags(item).forEach(function(tag) { tokens.push('tag:' + String(tag).toLowerCase()); });
    return tokens;
  }

  function matchesFilter(item, filter) {
    return itemTokens(item).indexOf(String(filter || '').toLowerCase()) > -1;
  }

  function matchesAllFilters(item, filters) {
    if (!filters.length) return true;
    return filters.every(function(filter) { return matchesFilter(item, filter); });
  }

  function matchesAnyFilter(item, filters) {
    return filters.some(function(filter) { return matchesFilter(item, filter); });
  }

  function filterLabel(kind, value) {
    if (kind === 'kind') return value === 'skit' ? 'Skits' : value === 'novel' ? 'Novel' : value.toUpperCase();
    if (kind === 'series') return 'Series: ' + value;
    return 'Tag: ' + value;
  }

  function collectFilterOptions() {
    var map = {};
    function add(kind, value) {
      if (!value) return;
      var key = kind + ':' + String(value).toLowerCase();
      if (!map[key]) map[key] = { value: key, label: filterLabel(kind, String(value)), kind: kind };
    }
    state.manifest.forEach(function(item) {
      add('kind', item.kind);
      add('series', item.series);
      displayTags(item).forEach(function(tag) { add('tag', tag); });
    });
    return Object.keys(map).sort(function(a, b) {
      var ka = map[a].kind === 'tag' ? 0 : map[a].kind === 'series' ? 1 : 2;
      var kb = map[b].kind === 'tag' ? 0 : map[b].kind === 'series' ? 1 : 2;
      return ka - kb || map[a].label.localeCompare(map[b].label);
    }).map(function(key) { return map[key]; });
  }

  function selectedSummary() {
    var show = state.includeFilters.length;
    var hide = state.excludeFilters.length;
    if (!show && !hide) return 'Everything';
    if (show && !hide) return show + ' selected';
    if (!show && hide) return hide + ' hidden';
    return show + ' selected \u00b7 ' + hide + ' hidden';
  }

  function filterMode(value) {
    if (state.includeFilters.indexOf(value) > -1) return 'include';
    if (state.excludeFilters.indexOf(value) > -1) return 'exclude';
    return 'neutral';
  }

  function updateFilterButtonLabels() {
    if (els.filterButton) els.filterButton.querySelector('strong').textContent = selectedSummary();
  }

  function renderFilterPanel() {
    if (!els.filterPanel) return;
    var opts = collectFilterOptions();
    els.filterPanel.innerHTML = '<div class="filter-panel-head"><span>Click: show \u2192 hide \u2192 off</span><button type="button" data-clear="filters">Clear</button></div>' +
      '<div class="filter-options">' + opts.map(function(opt) {
        var mode = filterMode(opt.value);
        var symbol = mode === 'include' ? '\u2713' : mode === 'exclude' ? '\u00d7' : '';
        return '<button type="button" class="filter-option filter-option-' + mode + '" data-filter-value="' + escapeHtml(opt.value) + '"><span class="filter-state">' + symbol + '</span><span>' + escapeHtml(opt.label) + '</span></button>';
      }).join('') + '</div>';
  }

  function populateFilterSelects() {
    renderFilterPanel();
    updateFilterButtonLabels();
  }

  function cycleFilter(value) {
    var inc = state.includeFilters.indexOf(value);
    var exc = state.excludeFilters.indexOf(value);
    if (inc === -1 && exc === -1) {
      state.includeFilters.push(value);
    } else if (inc > -1) {
      state.includeFilters.splice(inc, 1);
      if (state.excludeFilters.indexOf(value) === -1) state.excludeFilters.push(value);
    } else if (exc > -1) {
      state.excludeFilters.splice(exc, 1);
    }
    populateFilterSelects();
    renderLibrary();
  }

  function tagChips(item) {
    var tags = displayTags(item);
    var canonStatus = canonTag(item);
    if (!tags.length) return '';
    return '<div class="tag-list" aria-label="Tags">' + tags.map(function(tag) {
      var statusClass = tag === canonStatus ? (item.canon ? ' canon-status' : ' non-canon-status') : '';
      return '<span class="tag-chip' + statusClass + '">' + escapeHtml(tag) + '</span>';
    }).join('') + '</div>';
  }

  function renderLibrary() {
    var q = state.search.trim().toLowerCase();
    var items = state.manifest.filter(function(it) {
      if (!matchesAllFilters(it, state.includeFilters)) return false;
      if (matchesAnyFilter(it, state.excludeFilters)) return false;
      if (!q) return true;
      return [it.title, it.preview, it.excerpt, it.kind, it.series, displayTags(it).join(' ')].join(' ').toLowerCase().indexOf(q) > -1;
    });
    els.libraryGrid.innerHTML = items.map(function(it) {
      var released = isReleased(it);
      var p = released ? getProgress(it.id) : { percent: 0 };
      var pc = Math.round(p.percent || 0);
      var href = released ? '#reader/' + it.id : '#library';
      var badgeLabel = released ? labelFor(it) : (it.comingSoon ? 'COMING SOON' : 'COMING ' + formatReleaseDate(it.releaseAt));
      var chipText = released ? (pc ? pc + '%' : 'new') : '\uD83D\uDD12';
      return '<a class="work-card' + (released ? '' : ' locked') + '" href="' + href + '" aria-label="' + escapeHtml(it.title) + '">' +
        '<div class="card-top">' +
          '<span class="card-series">' + escapeHtml(badgeLabel) + '</span>' +
          '<span class="progress-chip">' + chipText + '</span>' +
        '</div>' +
        '<h2>' + escapeHtml(it.title) + '</h2>' +
        '<p class="card-preview">' + escapeHtml(it.preview || it.excerpt || 'No preview yet.') + '</p>' +
        tagChips(it) +
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
    function addVersioned(path, base) {
      var url = new URL(path, base);
      url.search = CACHE_KEY;
      set[url.href] = 1;
    }
    addVersioned(p, document.baseURI);
    addVersioned(p, new URL(MANIFEST_URL, document.baseURI));
    addVersioned('./' + p, document.baseURI);
    return Object.keys(set);
  }

  function fetchTextFile(item) {
    if (state.textCache[item.id]) return state.textCache[item.id];
    var urls = contentUrls(item);
    if (!urls.length) return Promise.reject(new Error('Invalid path.'));
    var lastErr = 'Unreachable.';
    function tryUrl(i) {
      if (i >= urls.length) return Promise.reject(new Error(lastErr));
      return fetch(urls[i], { cache: 'force-cache' }).then(function(r) {
        if (r.ok) return r.text();
        lastErr = r.status + ' ' + (r.statusText || 'Not Found');
        return tryUrl(i + 1);
      }).catch(function(e) {
        lastErr = e.message || lastErr;
        return tryUrl(i + 1);
      });
    }
    state.textCache[item.id] = tryUrl(0).catch(function(err) {
      delete state.textCache[item.id];
      throw err;
    });
    return state.textCache[item.id];
  }

  function openWork(id) {
    var item = state.manifest.find(function(e) { return e.id === id; });
    if (!item) { location.replace('#library'); return; }

    if (state.current && state.current.id !== item.id) stopTts();

    // Block unreleased content
    if (!isReleased(item)) {
      els.readerKind.textContent = 'COMING SOON';
      els.readerTitle.textContent = item.title;
      els.readerMeta.textContent = item.comingSoon ? 'No release date announced' : 'Available ' + formatReleaseDate(item.releaseAt);
      els.readerMeta.hidden = false;
      els.readerContent.innerHTML = item.comingSoon
        ? '<p class="muted">A new short story is coming soon to the library.</p>'
        : '<p class="muted">This content will be available on ' + formatReleaseDate(item.releaseAt) + '.</p>';
      if (els.utterancesWrap) els.utterancesWrap.innerHTML = '';
      return;
    }

    var rid = ++state.requestId;
    state.current = item;
    try { writeJson(STORAGE.last, { id: item.id, at: new Date().toISOString() }); } catch (e) {}
    els.readerKind.textContent = labelFor(item);
    els.readerTitle.textContent = item.title;
    var readMinutes = item.words ? Math.max(1, Math.ceil(item.words / 220)) : 0;
    els.readerMeta.textContent = item.words ? item.words.toLocaleString() + ' words \u00b7 ' + readMinutes + ' min read' : '';
    els.readerMeta.hidden = !item.words;
    els.readerContent.innerHTML = '<p class="muted">Loading text\u2026</p>';

    fetchTextFile(item).then(function(md) {
      if (rid !== state.requestId) return;
      requestAnimationFrame(function() {
        if (rid !== state.requestId) return;
        state.currentHtml = state.htmlCache[item.id] || markdownToHtml(md, item.title);
        state.htmlCache[item.id] = state.currentHtml;
        var saved = getProgress(item.id);
        setReadingProgress(saved.percent || 0);
        els.readerContent.classList.remove('type-cursor', 'letter-glitch');
        els.readerContent.innerHTML = state.currentHtml;
        prepareReaderExperience();
        restoreScroll(saved.scroll || 0);
        els.readerArticle.focus({ preventScroll: true });
        idleTask(loadUtterances, 1800);
        updateContinueButton();
      });
    }).catch(function(err) {
      if (rid !== state.requestId) return;
      els.readerContent.innerHTML = '<p class="muted">Could not load this text.</p><p>' + escapeHtml(err.message) + '</p>';
    });
  }

  function restoreScroll(y) {
    state.restoring = true;
    requestAnimationFrame(function() {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      requestAnimationFrame(function() {
        refreshReaderMetrics();
        state.restoring = false;
        updateReadingProgress();
        updateAmbientFromScroll();
      });
    });
  }

  function refreshReaderMetrics() {
    if (!els.readerContent) return;
    var rect = els.readerContent.getBoundingClientRect();
    state.readerMetrics = {
      start: window.scrollY + rect.top,
      end: window.scrollY + rect.bottom
    };
  }

  function updateReadingProgress() {
    if (!state.current || state.restoring) return;
    if (location.hash.indexOf('#reader/' + state.current.id) !== 0) return;
    var start = state.readerMetrics.start;
    var distance = Math.max(1, state.readerMetrics.end - start);
    var readingLine = window.scrollY + window.innerHeight * 0.45;
    var pct = Math.max(0, Math.min(100, ((readingLine - start) / distance) * 100));
    state.pendingProgress = { id: state.current.id, percent: pct, scroll: window.scrollY };
    if (Date.now() - state.lastProgressSave > 1800) flushReadingProgress();
    setReadingProgress(pct);
  }

  function flushReadingProgress() {
    if (!state.pendingProgress) return;
    var pending = state.pendingProgress;
    state.pendingProgress = null;
    state.lastProgressSave = Date.now();
    try { setProgress(pending.id, { percent: pending.percent, scroll: pending.scroll }); } catch (e) {}
  }

  function setReadingProgress(percent) {
    var pct = Math.max(0, Math.min(100, Number(percent) || 0));
    var rounded = Math.round(pct);
    els.readerProgressBar.style.transform = 'scaleY(' + (pct / 100) + ')';
    if (state.renderedProgress !== rounded) {
      state.renderedProgress = rounded;
      els.readerProgressValue.textContent = rounded + '%';
      els.readerProgress.setAttribute('aria-valuenow', String(rounded));
    }
  }

  function idleTask(fn, timeout) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: timeout || 1200 });
    } else {
      window.setTimeout(fn, 350);
    }
  }

  /* ---- narration and story ambience ---- */
  var narration = {
    chunks: [],
    index: -1,
    token: 0,
    speaking: false,
    paused: false,
    activeElement: null,
    activeWord: null,
    wordSpans: [],
    lastFollowAt: 0,
    charIndex: 0,
    utterance: null
  };

  function narrationSource(element) {
    var raw = element.textContent || '';
    var text = '';
    var domOffsets = [];
    var matcher = /\S+/g;
    var match;
    while ((match = matcher.exec(raw))) {
      if (text) {
        text += ' ';
        domOffsets.push(Math.max(0, match.index - 1));
      }
      for (var index = 0; index < match[0].length; index++) {
        text += match[0].charAt(index);
        domOffsets.push(match.index + index);
      }
    }
    return { text: text, domOffsets: domOffsets };
  }

  function splitNarration(source, element) {
    var chunks = [];
    var text = source.text;
    var start = 0;
    while (start < text.length) {
      while (/\s/.test(text.charAt(start))) start++;
      if (start >= text.length) break;
      var end = Math.min(text.length, start + 240);
      if (end < text.length) {
        var sample = text.slice(start, end);
        var punctuation = Math.max(sample.lastIndexOf('. '), sample.lastIndexOf('! '), sample.lastIndexOf('? '));
        if (punctuation >= 80) end = start + punctuation + 1;
        else {
          var space = text.lastIndexOf(' ', end);
          if (space > start) end = space;
        }
      }
      chunks.push({
        element: element,
        text: text.slice(start, end),
        domOffsets: source.domOffsets.slice(start, end)
      });
      start = end;
    }
    return chunks;
  }

  function prepareReaderExperience() {
    stopTts();
    narration.chunks = [];
    var blocks = Array.from(els.readerContent.querySelectorAll('p, h1, h2, h3, li, blockquote'));
    blocks.forEach(function(block, index) {
      var source = narrationSource(block);
      if (!source.text) return;
      block.dataset.readerBlock = String(index);
      narration.chunks = narration.chunks.concat(splitNarration(source, block));
    });
    prepareAmbientBlocks();
    updateNarrationControls();
  }

  function narrationStartIndex() {
    var target = window.innerHeight * 0.34;
    var firstAfter = narration.chunks.findIndex(function(chunk) {
      return chunk.element.getBoundingClientRect().bottom >= target;
    });
    return firstAfter < 0 ? 0 : firstAfter;
  }

  function selectedVoice() {
    if (!('speechSynthesis' in window) || !els.ttsVoice) return null;
    var voices = window.speechSynthesis.getVoices();
    return voices.find(function(voice) { return voice.voiceURI === els.ttsVoice.value; }) || null;
  }

  function populateVoices() {
    if (!els.ttsVoice || !('speechSynthesis' in window)) return;
    var previous = state.preferredVoice || els.ttsVoice.value;
    var voices = window.speechSynthesis.getVoices();
    function scoreVoice(voice) {
      var name = voice.name.toLowerCase();
      var lang = voice.lang.toLowerCase();
      var score = lang.indexOf('en') === 0 ? 100 : 0;
      if (voice.localService) score += 55;
      if (/natural|neural|enhanced/.test(name)) score += 20;
      if (/online/.test(name)) score -= 25;
      if (/zira|susan|george|aria|jenny|guy|sonia|ryan|david/.test(name)) score += 18;
      if (/en-us|en-gb|en-au/.test(lang)) score += 8;
      if (voice.default && lang.indexOf('en') === 0) score += 6;
      return score;
    }
    voices = voices.slice().sort(function(a, b) {
      return scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name);
    });
    var chosen = voices.find(function(voice) { return voice.voiceURI === previous; });
    var reliableEnglish = voices.find(function(voice) {
      return voice.localService && voice.lang.toLowerCase().indexOf('en') === 0;
    });
    if (!chosen || scoreVoice(chosen) < 100 || (!state.voiceChosenByUser && reliableEnglish && !chosen.localService)) {
      chosen = reliableEnglish || voices.find(function(voice) { return scoreVoice(voice) >= 100; }) || voices[0];
    }
    els.ttsVoice.replaceChildren();
    voices.forEach(function(voice) {
      var option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = voice.name + ' \u00b7 ' + voice.lang + (chosen && voice.voiceURI === chosen.voiceURI ? ' \u00b7 Recommended' : '');
      option.selected = !!chosen && voice.voiceURI === chosen.voiceURI;
      els.ttsVoice.appendChild(option);
    });
    state.preferredVoice = chosen ? chosen.voiceURI : '';
    els.ttsVoice.disabled = voices.length === 0;
  }

  function clearNarrationHighlight() {
    if (narration.activeWord) narration.activeWord.classList.remove('tts-word-current');
    narration.activeWord = null;
    var wordElement = narration.activeElement;
    narration.wordSpans.forEach(function(span) {
      if (span.isConnected) span.replaceWith(document.createTextNode(span.textContent));
    });
    narration.wordSpans = [];
    if (wordElement) wordElement.normalize();
    if (narration.activeElement) {
      narration.activeElement.classList.remove('tts-active');
      narration.activeElement.removeAttribute('aria-current');
    }
    narration.activeElement = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete('haru-tts-word');
  }

  function prepareNarrationWordSpans(element) {
    if (narration.wordSpans.length || !element) return;
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    var rawCursor = 0;
    nodes.forEach(function(textNode) {
      var value = textNode.nodeValue || '';
      var nodeStart = rawCursor;
      rawCursor += value.length;
      var matcher = /[\p{L}\p{N}]+(?:[\u2019'\-][\p{L}\p{N}]+)*/gu;
      var match;
      var last = 0;
      var fragment = document.createDocumentFragment();
      var changed = false;
      while ((match = matcher.exec(value))) {
        changed = true;
        if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));
        var span = document.createElement('span');
        span.className = 'tts-word';
        span.dataset.ttsRawStart = String(nodeStart + match.index);
        span.dataset.ttsRawEnd = String(nodeStart + match.index + match[0].length);
        span.textContent = match[0];
        fragment.appendChild(span);
        narration.wordSpans.push(span);
        last = match.index + match[0].length;
      }
      if (!changed) return;
      if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
      textNode.replaceWith(fragment);
    });
  }

  function spokenWordRange(text, charIndex) {
    var at = Math.max(0, Math.min(text.length, Number(charIndex) || 0));
    while (at < text.length && /\s/.test(text.charAt(at))) at++;
    var tail = text.slice(at);
    var match = /[\p{L}\p{N}]+(?:[\u2019'\-][\p{L}\p{N}]+)*/u.exec(tail);
    if (!match) match = /^\S+/.exec(tail);
    if (!match) return { start: at, length: 1 };
    return { start: at + match.index, length: Math.max(1, match[0].length) };
  }

  function setNarrationPassage(chunk) {
    if (narration.activeElement === chunk.element) return;
    clearNarrationHighlight();
    narration.activeElement = chunk.element;
    chunk.element.classList.add('tts-active');
    chunk.element.setAttribute('aria-current', 'true');
    followNarrationElement(chunk.element);
    prepareNarrationWordSpans(chunk.element);
  }

  function setNarrationHighlight(chunk, charIndex, charLength) {
    setNarrationPassage(chunk);
    var localStart = Math.max(0, Math.min(chunk.text.length - 1, Number(charIndex) || 0));
    var localLength = Math.max(1, Number(charLength) || 1);
    var localEnd = Math.min(chunk.text.length, localStart + localLength);
    var startAt = chunk.domOffsets[localStart];
    var endAt = chunk.domOffsets[Math.max(localStart, localEnd - 1)] + 1;
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return;
    var target = narration.wordSpans.find(function(span) {
      var rawStart = Number(span.dataset.ttsRawStart);
      var rawEnd = Number(span.dataset.ttsRawEnd);
      return rawStart < endAt && rawEnd > startAt;
    });
    if (!target && narration.wordSpans.length) {
      target = narration.wordSpans.reduce(function(closest, span) {
        return Math.abs(Number(span.dataset.ttsRawStart) - startAt) < Math.abs(Number(closest.dataset.ttsRawStart) - startAt) ? span : closest;
      });
    }
    if (!target || narration.activeWord === target) return;
    if (narration.activeWord) narration.activeWord.classList.remove('tts-word-current');
    target.classList.add('tts-word-current');
    narration.activeWord = target;
  }

  function followNarrationElement(element) {
    if (!state.narrationFollow || !element) return;
    var now = Date.now();
    var rect = element.getBoundingClientRect();
    var safeBottom = window.innerHeight * 0.76;
    if (rect.bottom <= safeBottom || rect.top < 0 || now - narration.lastFollowAt < 1400) return;
    var target = window.scrollY + rect.top - window.innerHeight * 0.38;
    if (target <= window.scrollY + 48) return;
    narration.lastFollowAt = now;
    var reduced = state.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    window.scrollTo({ top: target, left: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  function speakNarrationChunk(index, token, resumeAt) {
    if (!narration.speaking || token !== narration.token) return;
    if (index >= narration.chunks.length) {
      narration.speaking = false;
      narration.paused = false;
      narration.index = -1;
      narration.charIndex = 0;
      narration.utterance = null;
      clearNarrationHighlight();
      updateNarrationControls('Finished');
      setTtsDockExpanded(false);
      return;
    }
    narration.index = index;
    var chunk = narration.chunks[index];
    var utteranceStart = Math.max(0, Math.min(chunk.text.length, Number(resumeAt) || 0));
    while (utteranceStart < chunk.text.length && /\s/.test(chunk.text.charAt(utteranceStart))) utteranceStart++;
    if (utteranceStart >= chunk.text.length) {
      narration.charIndex = 0;
      speakNarrationChunk(index + 1, token, 0);
      return;
    }
    narration.charIndex = utteranceStart;
    var utterance = new SpeechSynthesisUtterance(chunk.text.slice(utteranceStart));
    narration.utterance = utterance;
    var voice = selectedVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice ? voice.lang : 'en-US';
    utterance.rate = Number(els.ttsRate && els.ttsRate.value) || 1;
    utterance.onstart = function() {
      if (token !== narration.token) return;
      setNarrationPassage(chunk);
      updateNarrationControls('Reading passage ' + (index + 1) + ' of ' + narration.chunks.length);
    };
    utterance.onboundary = function(event) {
      if (token !== narration.token) return;
      if (event.name && event.name !== 'word') return;
      var boundaryIndex = Number(event.charIndex);
      if (!Number.isFinite(boundaryIndex) || boundaryIndex < 0 || boundaryIndex >= utterance.text.length) return;
      var word = spokenWordRange(chunk.text, utteranceStart + boundaryIndex);
      narration.charIndex = word.start;
      setNarrationHighlight(chunk, word.start, word.length);
    };
    utterance.onend = function() {
      if (token !== narration.token || !narration.speaking) return;
      narration.charIndex = 0;
      narration.utterance = null;
      speakNarrationChunk(index + 1, token, 0);
    };
    utterance.onerror = function(event) {
      if (token !== narration.token || event.error === 'canceled' || event.error === 'interrupted') return;
      narration.speaking = false;
      narration.paused = false;
      narration.utterance = null;
      updateNarrationControls('Narration stopped');
      setTtsDockExpanded(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  function toggleTts() {
    if (!('speechSynthesis' in window) || !narration.chunks.length) return;
    setTtsDockExpanded(true);
    if (narration.speaking && !narration.paused) {
      narration.token++;
      narration.paused = true;
      narration.utterance = null;
      window.speechSynthesis.cancel();
      updateNarrationControls('Paused');
      return;
    }
    if (narration.speaking && narration.paused) {
      narration.paused = false;
      narration.token++;
      var resumeToken = narration.token;
      var resumeIndex = narration.index;
      var resumeAt = narration.charIndex;
      updateNarrationControls('Resuming');
      window.setTimeout(function() {
        if (!narration.speaking || narration.paused || resumeToken !== narration.token) return;
        speakNarrationChunk(resumeIndex, resumeToken, resumeAt);
      }, 80);
      return;
    }
    narration.speaking = true;
    narration.paused = false;
    narration.charIndex = 0;
    narration.token++;
    var startToken = narration.token;
    var startIndex = narrationStartIndex();
    updateNarrationControls('Starting');
    window.speechSynthesis.cancel();
    window.setTimeout(function() {
      if (!narration.speaking || narration.paused || startToken !== narration.token) return;
      speakNarrationChunk(startIndex, startToken, 0);
    }, 80);
  }

  function stopTts() {
    narration.token++;
    narration.speaking = false;
    narration.paused = false;
    narration.index = -1;
    narration.charIndex = 0;
    narration.utterance = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    clearNarrationHighlight();
    updateNarrationControls();
    setTtsDockExpanded(false);
  }

  function setTtsDockExpanded(expanded) {
    state.ttsExpanded = !!expanded;
    if (!els.readerTools || !els.ttsToggle) return;
    els.readerTools.classList.toggle('is-expanded', state.ttsExpanded);
    els.ttsToggle.setAttribute('aria-expanded', state.ttsExpanded ? 'true' : 'false');
    if (!state.ttsExpanded) setSettingsOpen(false);
  }

  function updateNarrationControls(status) {
    if (!els.ttsToggle) return;
    var supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    els.ttsToggle.disabled = !supported || !narration.chunks.length;
    els.ttsStop.disabled = !narration.speaking;
    els.ttsToggle.setAttribute('aria-pressed', narration.speaking && !narration.paused ? 'true' : 'false');
    els.ttsToggleLabel.textContent = narration.speaking && !narration.paused ? 'Pause' : narration.paused ? 'Resume' : 'Read aloud';
    els.ttsToggle.querySelector('.tool-icon').textContent = narration.speaking && !narration.paused ? '\u275A\u275A' : '\u25B6';
    if (els.ttsStatus) els.ttsStatus.textContent = status || (supported ? 'Ready to read' : 'Read aloud is unavailable in this browser');
  }

  function prepareAmbientBlocks() {
    state.ambientBlocks = [];
    var previous = '';
    Array.from(els.readerContent.querySelectorAll('[data-ambient]')).forEach(function(block) {
      var scene = block.dataset.ambient;
      if (scene === previous) return;
      previous = scene;
      state.ambientBlocks.push({
        element: block,
        scene: scene,
        top: 0
      });
    });
    refreshAmbientBlockPositions();
    updateAmbientFromScroll();
  }

  function updateAmbientPositions() {
    refreshAmbientBlockPositions();
    updateAmbientFromScroll();
  }

  function refreshAmbientBlockPositions() {
    state.ambientBlocks.forEach(function(block) {
      block.top = window.scrollY + block.element.getBoundingClientRect().top;
    });
  }

  function updateAmbientFromScroll() {
    if (!state.ambientBlocks.length || state.activeView !== 'reader') return;
    var focus = window.scrollY + window.innerHeight * 0.68;
    var active = state.ambientBlocks[0];
    for (var i = 1; i < state.ambientBlocks.length; i++) {
      if (state.ambientBlocks[i].top > focus) break;
      active = state.ambientBlocks[i];
    }
    setAmbientScene(active.scene);
  }

  function setAmbientScene(scene) {
    var scenes = String(scene || '').split(/\s+/).filter(function(item, index, all) {
      return AMBIENT_SCENES.indexOf(item) > -1 && all.indexOf(item) === index;
    });
    if (!scenes.length) scenes = ['neutral'];
    var nextScene = scenes.join(' ');
    var ambienceClassMatches = els.body.classList.contains('ambience-off') === !state.ambienceEnabled;
    if (state.ambientScene === nextScene && els.body.dataset.ambient === nextScene && ambienceClassMatches) return;
    state.ambientScene = nextScene;
    els.body.dataset.ambient = state.ambientScene;
    AMBIENT_SCENES.forEach(function(item) { els.body.classList.toggle('ambient-' + item, scenes.indexOf(item) > -1); });
    if (els.ambientLayers) {
      els.ambientLayers.forEach(function(layer) {
        var layerScene = layer.className.match(/ambient-([a-z-]+)/g) || [];
        var activeLayer = layerScene.some(function(name) { return scenes.indexOf(name.slice(8)) > -1; });
        layer.classList.toggle('is-active', activeLayer);
      });
    }
    els.body.classList.toggle('ambience-off', !state.ambienceEnabled);
    if (els.ambientToggle) {
      var label = scenes.map(function(item) { return item === 'neutral' ? 'calm' : item; }).join(' + ');
      els.ambientToggle.textContent = state.ambienceEnabled ? 'On' : 'Off';
      els.ambientToggle.setAttribute('aria-pressed', state.ambienceEnabled ? 'true' : 'false');
      els.ambientToggle.title = state.ambienceEnabled ? 'Story ambience is ' + label : 'Story ambience is off';
    }
  }

  function saveReaderPrefs() {
    try {
      writeJson(STORAGE.readerPrefs, {
        ambience: state.ambienceEnabled,
        reduceMotion: state.reduceMotion,
        narrationFollow: state.narrationFollow,
        fontScale: state.fontScale,
        readerWidth: state.readerWidth,
        readerSpacing: state.readerSpacing,
        preferredVoice: state.preferredVoice,
        voiceChosenByUser: state.voiceChosenByUser,
        ttsRate: state.ttsRate
      });
    } catch (e) {}
  }

  function applyReaderPrefs() {
    var prefs = readJson(STORAGE.readerPrefs, {});
    var systemReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.ambienceEnabled = prefs.ambience !== false;
    state.reduceMotion = typeof prefs.reduceMotion === 'boolean' ? prefs.reduceMotion : systemReduced;
    state.narrationFollow = prefs.narrationFollow !== false;
    state.fontScale = Math.max(.9, Math.min(1.25, Number(prefs.fontScale) || 1));
    state.readerWidth = [58, 68, 76].indexOf(Number(prefs.readerWidth)) > -1 ? Number(prefs.readerWidth) : 68;
    state.readerSpacing = [1.72, 1.88, 2.06].indexOf(Number(prefs.readerSpacing)) > -1 ? Number(prefs.readerSpacing) : 1.88;
    state.preferredVoice = typeof prefs.preferredVoice === 'string' ? prefs.preferredVoice : '';
    state.voiceChosenByUser = prefs.voiceChosenByUser === true;
    state.ttsRate = [0.8, 1, 1.15, 1.3].indexOf(Number(prefs.ttsRate)) > -1 ? Number(prefs.ttsRate) : 1;
    els.body.style.setProperty('--reader-font-scale', state.fontScale);
    els.body.style.setProperty('--reader-measure', state.readerWidth + 'ch');
    els.body.style.setProperty('--reader-line-height', state.readerSpacing);
    els.body.classList.toggle('reader-reduced-motion', state.reduceMotion);
    if (els.motionToggle) {
      els.motionToggle.textContent = state.reduceMotion ? 'On' : 'Off';
      els.motionToggle.setAttribute('aria-pressed', state.reduceMotion ? 'true' : 'false');
    }
    if (els.ttsFollowToggle) {
      els.ttsFollowToggle.textContent = state.narrationFollow ? 'On' : 'Off';
      els.ttsFollowToggle.setAttribute('aria-pressed', state.narrationFollow ? 'true' : 'false');
    }
    if (els.fontSizeValue) els.fontSizeValue.textContent = Math.round(state.fontScale * 100) + '%';
    if (els.readerWidth) els.readerWidth.value = String(state.readerWidth);
    if (els.readerSpacing) els.readerSpacing.value = String(state.readerSpacing);
    if (els.ttsRate) els.ttsRate.value = String(state.ttsRate);
    setAmbientScene(state.ambientScene);
  }

  function changeFontSize(delta) {
    state.fontScale = Math.round(Math.max(.9, Math.min(1.25, state.fontScale + delta)) * 100) / 100;
    els.body.style.setProperty('--reader-font-scale', state.fontScale);
    if (els.fontSizeValue) els.fontSizeValue.textContent = Math.round(state.fontScale * 100) + '%';
    saveReaderPrefs();
    requestAnimationFrame(function() {
      refreshReaderMetrics();
      updateAmbientPositions();
      updateReadingProgress();
    });
  }

  function setSettingsOpen(open) {
    if (!els.readerSettings || !els.settingsToggle) return;
    els.readerSettings.hidden = !open;
    els.settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ---- content warnings from manifest items ---- */
  function parseContentWarnings(md) {
    var m = md.match(/^>\s*\*?\*?[Cc]ontent warning:?\*?\*?\s*(.+)$/m);
    return m ? warningTagsFromText(m[1]) : [];
  }

  function warningTagsFromText(text) {
    return String(text || '')
      .replace(/^\s*[Cc]ontent warnings?:?\s*/, '')
      .split(/[,;]\s*/)
      .map(function(tag) {
        return tag.replace(/^\s*(?:and|or)\s+/i, '').replace(/[.?!]+\s*$/, '').replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);
  }

  function aggregateContentWarnings() {
    var seen = {};
    var all = [];
    state.manifest.forEach(function(it) {
      var cw = it._warnings || [];
      cw.forEach(function(w) {
        var key = w.toLowerCase();
        if (!seen[key]) { seen[key] = true; all.push(w); }
      });
    });
    return all.length ? all : ['Violence', 'Death', 'Psychological distress', 'Mature themes'];
  }

  function renderContentWarnings() {
    if (!els.warningText) return;
    els.warningText.replaceChildren();
    aggregateContentWarnings().forEach(function(w) {
      var tag = document.createElement('span');
      tag.className = 'warning-tag';
      tag.setAttribute('role', 'listitem');
      tag.textContent = w.charAt(0).toUpperCase() + w.slice(1);
      els.warningText.appendChild(tag);
    });
  }

  function closeFilterPanels() {
    if (!els.filterButton || !els.filterPanel) return;
    els.filterPanel.hidden = true;
    els.filterButton.setAttribute('aria-expanded', 'false');
    var menu = els.filterButton.closest('.filter-menu');
    if (menu) menu.classList.remove('open');
  }

  /* ---- events ---- */
  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', function() {
      if (state.activeView === 'reader') {
        els.body.classList.add('reader-scrolling');
        window.clearTimeout(state.readerScrollStopTimer);
        state.readerScrollStopTimer = window.setTimeout(function() {
          els.body.classList.remove('reader-scrolling');
        }, 130);
      }
      if (state.scrollQueued) return;
      state.scrollQueued = true;
      window.requestAnimationFrame(function() {
        state.scrollQueued = false;
        updateReadingProgress();
        updateAmbientFromScroll();
        updateHomeScroll();
      });
    }, { passive: true });
    window.addEventListener('resize', function() {
      requestAnimationFrame(function() {
        refreshReaderMetrics();
        updateReadingProgress();
        updateAmbientPositions();
      });
    }, { passive: true });
    window.addEventListener('pagehide', flushReadingProgress);
    if (els.ttsToggle) els.ttsToggle.addEventListener('click', toggleTts);
    if (els.ttsStop) els.ttsStop.addEventListener('click', stopTts);
    if (els.ttsCollapse) els.ttsCollapse.addEventListener('click', function() { setTtsDockExpanded(false); });
    if (els.ttsVoice) {
      els.ttsVoice.addEventListener('change', function() {
        state.preferredVoice = els.ttsVoice.value;
        state.voiceChosenByUser = true;
        saveReaderPrefs();
      });
    }
    if (els.ttsRate) {
      els.ttsRate.addEventListener('change', function() {
        state.ttsRate = Number(els.ttsRate.value) || 1;
        saveReaderPrefs();
      });
    }
    if (els.settingsToggle) {
      els.settingsToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        setSettingsOpen(els.readerSettings.hidden);
      });
    }
    if (els.settingsClose) els.settingsClose.addEventListener('click', function() { setSettingsOpen(false); });
    if (els.readerSettings) els.readerSettings.addEventListener('click', function(e) { e.stopPropagation(); });
    if (els.ambientToggle) {
      els.ambientToggle.addEventListener('click', function() {
        state.ambienceEnabled = !state.ambienceEnabled;
        setAmbientScene(state.ambientScene);
        saveReaderPrefs();
      });
    }
    if (els.motionToggle) {
      els.motionToggle.addEventListener('click', function() {
        state.reduceMotion = !state.reduceMotion;
        els.body.classList.toggle('reader-reduced-motion', state.reduceMotion);
        els.motionToggle.textContent = state.reduceMotion ? 'On' : 'Off';
        els.motionToggle.setAttribute('aria-pressed', state.reduceMotion ? 'true' : 'false');
        saveReaderPrefs();
      });
    }
    if (els.ttsFollowToggle) {
      els.ttsFollowToggle.addEventListener('click', function() {
        state.narrationFollow = !state.narrationFollow;
        els.ttsFollowToggle.textContent = state.narrationFollow ? 'On' : 'Off';
        els.ttsFollowToggle.setAttribute('aria-pressed', state.narrationFollow ? 'true' : 'false');
        saveReaderPrefs();
      });
    }
    if (els.fontSmaller) els.fontSmaller.addEventListener('click', function() { changeFontSize(-.05); });
    if (els.fontLarger) els.fontLarger.addEventListener('click', function() { changeFontSize(.05); });
    if (els.readerWidth) {
      els.readerWidth.addEventListener('change', function() {
        state.readerWidth = Number(els.readerWidth.value) || 68;
        els.body.style.setProperty('--reader-measure', state.readerWidth + 'ch');
        saveReaderPrefs();
        requestAnimationFrame(function() { refreshReaderMetrics(); updateReadingProgress(); updateAmbientPositions(); });
      });
    }
    if (els.readerSpacing) {
      els.readerSpacing.addEventListener('change', function() {
        state.readerSpacing = Number(els.readerSpacing.value) || 1.88;
        els.body.style.setProperty('--reader-line-height', state.readerSpacing);
        saveReaderPrefs();
        requestAnimationFrame(function() { refreshReaderMetrics(); updateReadingProgress(); updateAmbientPositions(); });
      });
    }
    if (els.searchInput) {
      els.searchInput.addEventListener('input', function(e) { state.search = e.target.value; renderLibrary(); });
    }
    function togglePanel() {
      if (!els.filterButton || !els.filterPanel) return;
      var willOpen = els.filterPanel.hidden;
      closeFilterPanels();
      els.filterPanel.hidden = !willOpen;
      els.filterButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      els.filterButton.closest('.filter-menu').classList.toggle('open', willOpen);
    }
    if (els.filterButton) {
      els.filterButton.addEventListener('click', function(e) { e.stopPropagation(); togglePanel(); });
    }
    if (els.filterPanel) {
      els.filterPanel.addEventListener('click', function(e) {
        e.stopPropagation();
        var option = e.target.closest('[data-filter-value]');
        if (option) {
          cycleFilter(option.dataset.filterValue);
          return;
        }
        if (e.target.matches('[data-clear]')) {
          state.includeFilters = [];
          state.excludeFilters = [];
          populateFilterSelects();
          renderLibrary();
        }
      });
    }
    document.addEventListener('click', function() { closeFilterPanels(); setSettingsOpen(false); });
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeFilterPanels(); setSettingsOpen(false); }
    });
  }

  /* ---- init ---- */
  function init() {
    cacheEls();
    applyReaderPrefs();
    bindEvents();
    populateVoices();
    if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
    updateNarrationControls();

    fetch(ROADMAP_URL, { cache: 'force-cache' }).then(function(r) {
      if (!r.ok) throw new Error('Could not load roadmap.');
      return r.text();
    }).then(function(md) {
      renderRoadmap(parseRoadmap(md));
    }).catch(function() {
      renderRoadmap([]);
    });

    fetch(MANIFEST_URL, { cache: 'force-cache' }).then(function(r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.json();
    }).then(function(data) {
      state.manifest = (data.items || []).map(function(it) {
        return Object.assign({}, it, {
          id: it.id || slugFromPath(it.path),
          _warnings: warningTagsFromText(it.contentWarning)
        });
      });

      renderContentWarnings();
      populateFilterSelects();
      renderLibrary();
      route();
      var last = readJson(STORAGE.last, null);
      var next = last && state.manifest.find(function(it) { return it.id === last.id && isReleased(it); });
      if (next) idleTask(function() { fetchTextFile(next).catch(function() {}); }, 2200);
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
